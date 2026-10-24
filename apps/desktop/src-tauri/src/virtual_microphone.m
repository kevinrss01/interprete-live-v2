#import <Foundation/Foundation.h>
#import <CoreAudio/CoreAudio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <signal.h>
#include <errno.h>
#include <unistd.h>

static AudioObjectPropertyAddress address(AudioObjectPropertySelector selector) {
  return (AudioObjectPropertyAddress){selector, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
}
static NSString *string_property(AudioObjectID object, AudioObjectPropertySelector selector) {
  CFStringRef value = NULL; UInt32 size = sizeof(value);
  AudioObjectPropertyAddress property = address(selector);
  if (AudioObjectGetPropertyData(object, &property, 0, NULL, &size, &value) != noErr || !value) return nil;
  return CFBridgingRelease(value);
}
static NSArray<NSNumber *> *all_devices(void) {
  AudioObjectPropertyAddress property = address(kAudioHardwarePropertyDevices);
  UInt32 size = 0;
  if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &property, 0, NULL, &size) != noErr) return nil;
  NSMutableData *data = [NSMutableData dataWithLength:size];
  if (size && AudioObjectGetPropertyData(kAudioObjectSystemObject, &property, 0, NULL, &size, data.mutableBytes) != noErr) return nil;
  NSMutableArray *devices = [NSMutableArray array];
  AudioObjectID *ids = data.mutableBytes;
  for (UInt32 index = 0; index < size / sizeof(AudioObjectID); index++) [devices addObject:@(ids[index])];
  return devices;
}
static AudioDeviceID device_for_uid(NSString *uid) {
  CFStringRef value = (__bridge CFStringRef)uid;
  AudioDeviceID device = kAudioObjectUnknown;
  UInt32 size = sizeof(device);
  AudioObjectPropertyAddress property = address(kAudioHardwarePropertyTranslateUIDToDevice);
  if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &property, sizeof(value), &value, &size, &device) != noErr) return kAudioObjectUnknown;
  return device;
}
static BOOL only_subdevice(AudioDeviceID device, NSString *uid) {
  CFArrayRef list = NULL; UInt32 size = sizeof(list);
  AudioObjectPropertyAddress property = address(kAudioAggregateDevicePropertyFullSubDeviceList);
  if (AudioObjectGetPropertyData(device, &property, 0, NULL, &size, &list) != noErr || !list) return NO;
  NSArray *devices = CFBridgingRelease(list);
  return devices.count == 1 && [devices[0] isEqual:uid];
}

// A public one-subdevice aggregate gives the existing loopback a stable app-owned identity.
// It neither changes the system defaults nor installs/modifies/restarts an audio driver.
char *interprete_virtual_outputs(const char *name_utf8, const char *uid_utf8, bool create) {
  @autoreleasepool { @synchronized([NSProcessInfo class]) {
    NSString *name = [NSString stringWithUTF8String:name_utf8];
    NSString *uid = [NSString stringWithUTF8String:uid_utf8];
    NSMutableArray *outputs = [NSMutableArray array];
    NSString *error = nil;
    NSArray<NSNumber *> *devices = all_devices();
    NSString *driver_uid = nil;
    for (NSNumber *number in devices) {
      AudioDeviceID device = number.unsignedIntValue;
      NSString *device_uid = string_property(device, kAudioDevicePropertyDeviceUID);
      NSString *device_name = string_property(device, kAudioObjectPropertyName);
      // Match the driver's documented UID, never an arbitrary user-renamed physical device.
      if ([device_uid isEqualToString:@"BlackHole2ch_UID"] && device_name) {
        driver_uid = device_uid;
        [outputs addObject:@{@"name": device_name, @"uid": device_uid, @"virtualMic": @YES, @"appMic": @NO}];
      }
    }
    if (!devices) error = @"Impossible de lire les périphériques CoreAudio.";
    if (driver_uid) {
      AudioDeviceID branded = device_for_uid(uid);
      if (branded == kAudioObjectUnknown && create) {
        NSDictionary *description = @{
          @kAudioAggregateDeviceNameKey: name, @kAudioAggregateDeviceUIDKey: uid,
          @kAudioAggregateDeviceSubDeviceListKey: @[@{@kAudioSubDeviceUIDKey: driver_uid}],
          @kAudioAggregateDeviceMainSubDeviceKey: driver_uid,
          @kAudioAggregateDeviceIsPrivateKey: @NO, @kAudioAggregateDeviceIsStackedKey: @NO,
        };
        OSStatus status = AudioHardwareCreateAggregateDevice((__bridge CFDictionaryRef)description, &branded);
        if (status != noErr) {
          branded = device_for_uid(uid); // Another instance may have created the same UID.
          if (branded == kAudioObjectUnknown) error = [NSString stringWithFormat:@"Création du micro de l’app impossible (CoreAudio %d).", (int)status];
        }
      }
      if (branded != kAudioObjectUnknown) {
        if (!only_subdevice(branded, driver_uid)) error = @"Le micro de l’app contient des périphériques inattendus. Vérifiez sa configuration dans Configuration audio et MIDI.";
        else {
          NSString *actual_name = string_property(branded, kAudioObjectPropertyName);
          if (actual_name) [outputs insertObject:@{@"name": actual_name, @"uid": uid, @"virtualMic": @YES, @"appMic": @YES} atIndex:0];
        }
      }
    }
    // CPAL 0.16 selects by name: fail closed if that name is shared by another device.
    NSArray<NSNumber *> *current_devices = all_devices();
    for (NSDictionary *output in outputs) {
      NSUInteger matches = 0;
      for (NSNumber *number in current_devices) if ([string_property(number.unsignedIntValue, kAudioObjectPropertyName) isEqual:output[@"name"]]) matches++;
      if (matches != 1) error = @"Plusieurs périphériques portent le nom du micro virtuel. Renommez le périphérique en double dans Configuration audio et MIDI.";
    }
    NSDictionary *result = error ? @{@"outputs": @[], @"error": error} : @{@"outputs": outputs};
    NSData *json = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
    return strdup([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
  } }
}

int interprete_default_input_uid(char *buffer, size_t capacity) {
  @autoreleasepool {
    AudioDeviceID device = 0; UInt32 size = sizeof(device);
    AudioObjectPropertyAddress property = address(kAudioHardwarePropertyDefaultInputDevice);
    OSStatus status = AudioObjectGetPropertyData(kAudioObjectSystemObject, &property, 0, NULL, &size, &device);
    if (status != noErr) return status;
    NSString *uid = string_property(device, kAudioDevicePropertyDeviceUID);
    if (!uid || ![uid getCString:buffer maxLength:capacity encoding:NSUTF8StringEncoding]) return kAudioHardwareUnspecifiedError;
    return noErr;
  }
}
int interprete_set_default_input_uid(const char *uid_utf8) {
  @autoreleasepool {
    AudioDeviceID device = device_for_uid([NSString stringWithUTF8String:uid_utf8]);
    if (device == kAudioObjectUnknown) return kAudioHardwareBadDeviceError;
    AudioObjectPropertyAddress property = address(kAudioHardwarePropertyDefaultInputDevice);
    return AudioObjectSetPropertyData(kAudioObjectSystemObject, &property, 0, NULL, sizeof(device), &device);
  }
}
int interprete_process_is_alive(unsigned int pid) {
  return kill((pid_t)pid, 0) == 0 || errno == EPERM;
}

// Read-only diagnostics used by the explicit synthetic loopback test.
int interprete_default_outputs(unsigned int *output, unsigned int *system_output) {
  AudioObjectPropertyAddress property = address(kAudioHardwarePropertyDefaultOutputDevice);
  UInt32 size = sizeof(*output);
  OSStatus status = AudioObjectGetPropertyData(kAudioObjectSystemObject, &property, 0, NULL, &size, output);
  if (status != noErr) return status;
  property.mSelector = kAudioHardwarePropertyDefaultSystemOutputDevice;
  size = sizeof(*system_output);
  return AudioObjectGetPropertyData(kAudioObjectSystemObject, &property, 0, NULL, &size, system_output);
}

int interprete_physical_input_fallback(char *buffer, size_t capacity) {
  @autoreleasepool {
    AudioDeviceID selected = kAudioObjectUnknown;
    for (NSNumber *number in all_devices()) {
      AudioDeviceID device = number.unsignedIntValue;
      AudioObjectPropertyAddress streams = { kAudioDevicePropertyStreams, kAudioObjectPropertyScopeInput, kAudioObjectPropertyElementMain };
      UInt32 size = 0;
      if (AudioObjectGetPropertyDataSize(device, &streams, 0, NULL, &size) != noErr || !size) continue;
      AudioObjectPropertyAddress transport = address(kAudioDevicePropertyTransportType);
      UInt32 type = 0; size = sizeof(type);
      if (AudioObjectGetPropertyData(device, &transport, 0, NULL, &size, &type) != noErr) continue;
      if (type == kAudioDeviceTransportTypeVirtual || type == kAudioDeviceTransportTypeAggregate) continue;
      if (selected == kAudioObjectUnknown || type == kAudioDeviceTransportTypeBuiltIn) selected = device;
      if (type == kAudioDeviceTransportTypeBuiltIn) break;
    }
    NSString *uid = string_property(selected, kAudioDevicePropertyDeviceUID);
    return uid && [uid getCString:buffer maxLength:capacity encoding:NSUTF8StringEncoding] ? noErr : kAudioHardwareBadDeviceError;
  }
}

#include <libproc.h>
#include <sys/proc_info.h>
unsigned long long interprete_process_start(unsigned int pid) {
  struct proc_bsdinfo info = {0};
  if (proc_pidinfo((int)pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info)) != sizeof(info)) return 0;
  return (unsigned long long)info.pbi_start_tvsec * 1000000ULL + info.pbi_start_tvusec;
}
