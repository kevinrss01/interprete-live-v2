#import <Foundation/Foundation.h>
#import <CoreAudio/CoreAudio.h>
#import <CoreAudio/AudioHardwareTapping.h>
#import <CoreAudio/CATapDescription.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

// Mono Float32 frames at the tap's native rate. Called on one serial queue, never concurrently.
typedef void (*interprete_tap_samples)(void *context, const float *samples, uint32_t frames, double rate);

@interface InterpreteTap : NSObject {
@public
  AudioObjectID tap;
  AudioObjectID aggregate;
  AudioDeviceIOProcID proc;
  interprete_tap_samples callback;
  void *context;
  double rate;
  float *mono;
  UInt32 capacity;
}
@property(nonatomic, strong) dispatch_queue_t queue;
@end
@implementation InterpreteTap
- (void)dealloc {
  free(mono);
}
@end

static char *owned_json(NSDictionary *value) {
  NSData *json = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  return strdup([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
}
static char *failure(NSString *message, OSStatus status) {
  return owned_json(@{@"error": [NSString stringWithFormat:@"%@ (CoreAudio %d)", message, (int)status]});
}
static AudioObjectPropertyAddress global_address(AudioObjectPropertySelector selector) {
  return (AudioObjectPropertyAddress){selector, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
}
static NSString *string_property(AudioObjectID object, AudioObjectPropertySelector selector) {
  AudioObjectPropertyAddress address = global_address(selector);
  CFStringRef value = NULL;
  UInt32 size = sizeof(value);
  if (AudioObjectGetPropertyData(object, &address, 0, NULL, &size, &value) != noErr || !value) return nil;
  return (__bridge_transfer NSString *)value;
}

// Processes whose bundle starts with one of the call app prefixes. Also reports this app's own process.
static NSArray<NSNumber *> *call_processes(NSArray<NSString *> *prefixes, AudioObjectID *own) {
  AudioObjectPropertyAddress list = global_address(kAudioHardwarePropertyProcessObjectList);
  UInt32 size = 0;
  if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &list, 0, NULL, &size) != noErr || size == 0) return @[];
  NSMutableData *storage = [NSMutableData dataWithLength:size];
  if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &list, 0, NULL, &size, storage.mutableBytes) != noErr) return @[];
  NSMutableArray<NSNumber *> *matches = [NSMutableArray array];
  pid_t me = getpid();
  AudioObjectID *ids = storage.mutableBytes;
  for (UInt32 i = 0; i < size / sizeof(AudioObjectID); i++) {
    AudioObjectPropertyAddress pidAddress = global_address(kAudioProcessPropertyPID);
    pid_t pid = 0;
    UInt32 length = sizeof(pid);
    if (AudioObjectGetPropertyData(ids[i], &pidAddress, 0, NULL, &length, &pid) == noErr && pid == me) {
      *own = ids[i];
      continue;
    }
    NSString *bundle = string_property(ids[i], kAudioProcessPropertyBundleID).lowercaseString;
    if (!bundle) continue;
    for (NSString *prefix in prefixes) {
      if ([bundle hasPrefix:prefix]) {
        [matches addObject:@(ids[i])];
        break;
      }
    }
  }
  return matches;
}

static void deliver(InterpreteTap *tap, const AudioBufferList *input) {
  if (!input || input->mNumberBuffers == 0) return;
  const AudioBuffer *first = &input->mBuffers[0];
  if (!first->mData || first->mNumberChannels == 0) return;
  UInt32 frames = first->mDataByteSize / (UInt32)(sizeof(float) * first->mNumberChannels);
  if (frames == 0) return;
  if (input->mNumberBuffers == 1 && first->mNumberChannels == 1) {
    tap->callback(tap->context, first->mData, frames, tap->rate);
    return;
  }
  // The queue is not the HAL real-time thread, so growing this buffer here is safe.
  if (frames > tap->capacity) {
    float *grown = realloc(tap->mono, frames * sizeof(float));
    if (!grown) return;
    tap->mono = grown;
    tap->capacity = frames;
  }
  memset(tap->mono, 0, frames * sizeof(float));
  UInt32 channels = 0;
  for (UInt32 b = 0; b < input->mNumberBuffers; b++) {
    const AudioBuffer *buffer = &input->mBuffers[b];
    UInt32 count = buffer->mNumberChannels;
    if (!buffer->mData || count == 0) continue;
    UInt32 available = buffer->mDataByteSize / (UInt32)(sizeof(float) * count);
    const float *samples = buffer->mData;
    for (UInt32 f = 0; f < frames && f < available; f++)
      for (UInt32 c = 0; c < count; c++) tap->mono[f] += samples[f * count + c];
    channels += count;
  }
  if (channels == 0) return;
  float scale = 1.0f / (float)channels;
  for (UInt32 f = 0; f < frames; f++) tap->mono[f] *= scale;
  tap->callback(tap->context, tap->mono, frames, tap->rate);
}

static void destroy(InterpreteTap *tap) API_AVAILABLE(macos(14.2)) {
  if (tap->aggregate != kAudioObjectUnknown && tap->proc) {
    AudioDeviceStop(tap->aggregate, tap->proc);
    AudioDeviceDestroyIOProcID(tap->aggregate, tap->proc);
    tap->proc = NULL;
  }
  // Blocks already queued must finish before Rust releases the callback context.
  if (tap.queue) dispatch_sync(tap.queue, ^{});
  if (tap->aggregate != kAudioObjectUnknown) AudioHardwareDestroyAggregateDevice(tap->aggregate);
  if (tap->tap != kAudioObjectUnknown) AudioHardwareDestroyProcessTap(tap->tap);
  tap->aggregate = kAudioObjectUnknown;
  tap->tap = kAudioObjectUnknown;
}

// Returns owned JSON: {"scope":"app"|"system","processes":n} or {"error":"..."}.
// Without matching processes, every app except Interprète is captured, so translated speech never loops back.
// With mute, the captured apps stay silent on the speakers while the tap is read; destroying it restores them.
char *interprete_tap_start(const char *prefixes_json, bool mute, interprete_tap_samples callback, void *context, void **handle) {
  @autoreleasepool {
    *handle = NULL;
    if (@available(macOS 14.2, *)) {
      NSArray<NSString *> *prefixes = @[];
      if (prefixes_json) {
        NSData *data = [NSData dataWithBytes:prefixes_json length:strlen(prefixes_json)];
        id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        if ([parsed isKindOfClass:NSArray.class]) prefixes = parsed;
      }
      AudioObjectID own = kAudioObjectUnknown;
      NSArray<NSNumber *> *processes = call_processes(prefixes, &own);
      if (own == kAudioObjectUnknown) {
        AudioObjectPropertyAddress translate = global_address(kAudioHardwarePropertyTranslatePIDToProcessObject);
        pid_t me = getpid();
        UInt32 size = sizeof(own);
        AudioObjectGetPropertyData(kAudioObjectSystemObject, &translate, sizeof(me), &me, &size, &own);
      }
      CATapDescription *description = processes.count
        ? [[CATapDescription alloc] initMonoMixdownOfProcesses:processes]
        : [[CATapDescription alloc] initMonoGlobalTapButExcludeProcesses:own == kAudioObjectUnknown ? @[] : @[@(own)]];
      description.UUID = [NSUUID UUID];
      description.name = @"Interprète";
      description.privateTap = YES;
      description.muteBehavior = mute ? CATapMutedWhenTapped : CATapUnmuted;

      InterpreteTap *tap = [InterpreteTap new];
      tap->tap = kAudioObjectUnknown;
      tap->aggregate = kAudioObjectUnknown;
      tap->callback = callback;
      tap->context = context;
      OSStatus status = AudioHardwareCreateProcessTap(description, &tap->tap);
      if (status != noErr) return failure(@"Unable to capture the call audio.", status);

      AudioStreamBasicDescription format = {0};
      UInt32 size = sizeof(format);
      AudioObjectPropertyAddress formatAddress = global_address(kAudioTapPropertyFormat);
      status = AudioObjectGetPropertyData(tap->tap, &formatAddress, 0, NULL, &size, &format);
      if (status != noErr || format.mFormatID != kAudioFormatLinearPCM || !(format.mFormatFlags & kAudioFormatFlagIsFloat) ||
          format.mBitsPerChannel != 32 || format.mSampleRate <= 0) {
        destroy(tap);
        return failure(@"Unsupported call audio format.", status);
      }
      tap->rate = format.mSampleRate;

      // A private aggregate device that only contains the tap: no microphone or output stream is mixed in.
      NSDictionary *aggregate = @{
        @kAudioAggregateDeviceNameKey: @"Interprète · call audio",
        @kAudioAggregateDeviceUIDKey: [NSUUID UUID].UUIDString,
        @kAudioAggregateDeviceIsPrivateKey: @YES,
        @kAudioAggregateDeviceIsStackedKey: @NO,
        @kAudioAggregateDeviceTapAutoStartKey: @YES,
        @kAudioAggregateDeviceTapListKey: @[@{
          @kAudioSubTapUIDKey: description.UUID.UUIDString,
          @kAudioSubTapDriftCompensationKey: @YES,
        }],
      };
      status = AudioHardwareCreateAggregateDevice((__bridge CFDictionaryRef)aggregate, &tap->aggregate);
      if (status != noErr) {
        destroy(tap);
        return failure(@"Unable to prepare the call capture.", status);
      }
      tap.queue = dispatch_queue_create(
        "ai.impulselab.interprete.call-audio",
        dispatch_queue_attr_make_with_qos_class(DISPATCH_QUEUE_SERIAL, QOS_CLASS_USER_INTERACTIVE, 0));
      // The handle owns the tap until destroy() has stopped the IOProc and drained the queue.
      __unsafe_unretained InterpreteTap *target = tap;
      status = AudioDeviceCreateIOProcIDWithBlock(&tap->proc, tap->aggregate, tap.queue,
        ^(__unused const AudioTimeStamp *now, const AudioBufferList *input, __unused const AudioTimeStamp *inputTime,
          __unused AudioBufferList *output, __unused const AudioTimeStamp *outputTime) {
          deliver(target, input);
        });
      if (status == noErr) status = AudioDeviceStart(tap->aggregate, tap->proc);
      if (status != noErr) {
        destroy(tap);
        return failure(@"Unable to start the call capture.", status);
      }
      *handle = (__bridge_retained void *)tap;
      return owned_json(@{@"scope": processes.count ? @"app" : @"system", @"processes": @(processes.count)});
    }
    return owned_json(@{@"error": @"Capturing call audio requires macOS 14.2 or later."});
  }
}

// Stops callbacks synchronously. After this returns, the callback context is never used again.
void interprete_tap_stop(void *handle) {
  if (!handle) return;
  @autoreleasepool {
    InterpreteTap *tap = (__bridge_transfer InterpreteTap *)handle;
    if (@available(macOS 14.2, *)) destroy(tap);
  }
}
