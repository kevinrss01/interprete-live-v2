#import <Foundation/Foundation.h>
#import <CoreAudio/CoreAudio.h>
#include <stdlib.h>
#include <string.h>

// Returns owned UTF-8 JSON; Rust frees it after copying. No audio is captured.
char *interprete_call_probe(void) {
  @autoreleasepool {
    NSMutableDictionary *result = [@{@"supported": @NO, @"processes": @[]} mutableCopy];
    if (@available(macOS 14.2, *)) {
      result[@"supported"] = @YES;
      AudioObjectPropertyAddress list = { kAudioHardwarePropertyProcessObjectList, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
      UInt32 size = 0;
      OSStatus status = AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &list, 0, NULL, &size);
      if (status == noErr && size > 0) {
        NSMutableData *storage = [NSMutableData dataWithLength:size];
        status = AudioObjectGetPropertyData(kAudioObjectSystemObject, &list, 0, NULL, &size, storage.mutableBytes);
        NSMutableArray *processes = [NSMutableArray array];
        if (status == noErr) {
          AudioObjectID *ids = storage.mutableBytes;
          for (UInt32 i = 0; i < size / sizeof(AudioObjectID); i++) {
            AudioObjectPropertyAddress running = { kAudioProcessPropertyIsRunningInput, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
            UInt32 active = 0, length = sizeof(active);
            if (AudioObjectGetPropertyData(ids[i], &running, 0, NULL, &length, &active) != noErr || !active) continue;
            AudioObjectPropertyAddress bundle = { kAudioProcessPropertyBundleID, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
            CFStringRef bundleID = NULL;
            length = sizeof(bundleID);
            if (AudioObjectGetPropertyData(ids[i], &bundle, 0, NULL, &length, &bundleID) != noErr || !bundleID) continue;
            [processes addObject:@{@"id": @((unsigned int)ids[i]), @"bundleId": (__bridge NSString *)bundleID}];
            CFRelease(bundleID);
          }
        }
        result[@"processes"] = processes;
      }
      if (status != noErr) result[@"error"] = [NSString stringWithFormat:@"CoreAudio: %d", (int)status];
    }
    NSData *json = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
    return strdup([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
  }
}

// Authoritative physical-input allow-list. User-named aggregate devices must not bypass loopback protection.
char *interprete_physical_inputs(void) {
  @autoreleasepool {
    AudioObjectPropertyAddress list = { kAudioHardwarePropertyDevices, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
    UInt32 size = 0;
    OSStatus status = AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &list, 0, NULL, &size);
    if (status != noErr) return NULL;
    NSMutableData *storage = [NSMutableData dataWithLength:size];
    if (size && AudioObjectGetPropertyData(kAudioObjectSystemObject, &list, 0, NULL, &size, storage.mutableBytes) != noErr) return NULL;
    NSMutableArray *names = [NSMutableArray array];
    AudioObjectID *ids = storage.mutableBytes;
    for (UInt32 i = 0; i < size / sizeof(AudioObjectID); i++) {
      AudioObjectPropertyAddress transport = { kAudioDevicePropertyTransportType, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
      UInt32 type = 0, length = sizeof(type);
      if (AudioObjectGetPropertyData(ids[i], &transport, 0, NULL, &length, &type) != noErr) continue;
      if (type == kAudioDeviceTransportTypeVirtual || type == kAudioDeviceTransportTypeAggregate) continue;
      AudioObjectPropertyAddress streams = { kAudioDevicePropertyStreams, kAudioObjectPropertyScopeInput, kAudioObjectPropertyElementMain };
      length = 0;
      if (AudioObjectGetPropertyDataSize(ids[i], &streams, 0, NULL, &length) != noErr || length == 0) continue;
      AudioObjectPropertyAddress name = { kAudioObjectPropertyName, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
      CFStringRef value = NULL;
      length = sizeof(value);
      if (AudioObjectGetPropertyData(ids[i], &name, 0, NULL, &length, &value) != noErr || !value) continue;
      [names addObject:(__bridge NSString *)value];
      CFRelease(value);
    }
    NSData *json = [NSJSONSerialization dataWithJSONObject:names options:0 error:nil];
    return strdup([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
  }
}

#import <AppKit/AppKit.h>
// Called from Tauri setup on the AppKit thread, before the prompt can be shown.
void interprete_configure_toast(void *window) {
  NSWindow *native = (__bridge NSWindow *)window;
  native.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary;
  native.level = NSFloatingWindowLevel;
}
