#import <Foundation/Foundation.h>
#import <CoreAudio/CoreAudio.h>
#import <CoreMediaIO/CMIOHardware.h>
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>
#include <stdlib.h>
#include <string.h>

// Implemented by virtual_camera.m: devices kept running by the camera relay itself.
bool interprete_camera_relay_uses(NSString *uid);

// True while any camera streams to some process. CoreMediaIO does not say which one, and
// reading this state needs no camera permission: no frame is opened. Cameras that the relay
// keeps running do not count, or Interprète would keep its own call alive.
static BOOL InterpreteCameraRunning(void) {
  CMIOObjectPropertyAddress list = { kCMIOHardwarePropertyDevices, kCMIOObjectPropertyScopeGlobal, kCMIOObjectPropertyElementMain };
  UInt32 size = 0;
  if (CMIOObjectGetPropertyDataSize(kCMIOObjectSystemObject, &list, 0, NULL, &size) != noErr || size == 0) return NO;
  NSMutableData *storage = [NSMutableData dataWithLength:size];
  UInt32 used = 0;
  if (CMIOObjectGetPropertyData(kCMIOObjectSystemObject, &list, 0, NULL, size, &used, storage.mutableBytes) != noErr) return NO;
  CMIOObjectID *ids = storage.mutableBytes;
  for (UInt32 i = 0; i < used / sizeof(CMIOObjectID); i++) {
    CMIOObjectPropertyAddress running = { kCMIODevicePropertyDeviceIsRunningSomewhere, kCMIOObjectPropertyScopeGlobal, kCMIOObjectPropertyElementMain };
    UInt32 active = 0, length = 0;
    if (CMIOObjectGetPropertyData(ids[i], &running, 0, NULL, sizeof(active), &length, &active) != noErr || !active) continue;
    CMIOObjectPropertyAddress identity = { kCMIODevicePropertyDeviceUID, kCMIOObjectPropertyScopeGlobal, kCMIOObjectPropertyElementMain };
    CFStringRef uid = NULL;
    if (CMIOObjectGetPropertyData(ids[i], &identity, 0, NULL, sizeof(uid), &length, &uid) == noErr && uid) {
      BOOL relayed = interprete_camera_relay_uses((__bridge NSString *)uid);
      CFRelease(uid);
      if (relayed) continue;
    }
    return YES;
  }
  return NO;
}

// Returns owned UTF-8 JSON; Rust frees it after copying. No audio or video is captured.
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
      // A meeting lobby can show the camera before any microphone opens.
      result[@"camera"] = @(InterpreteCameraRunning());
      NSString *frontmost = NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier;
      if (frontmost) result[@"frontmost"] = frontmost;
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

static char InterpreteOriginalClass;
// Floating windows that are not focusable: captions and the translation pill.
@interface InterpreteOverlayPanel : NSPanel
@end
@implementation InterpreteOverlayPanel
- (BOOL)canBecomeKeyWindow {
  return NO;
}
- (BOOL)canBecomeMainWindow {
  return NO;
}
// NSWindow's teardown expects the class the window was created with, and tao always closes a
// window before releasing it.
- (void)close {
  Class original = objc_getAssociatedObject(self, &InterpreteOriginalClass);
  if (!original) {
    [super close];
    return;
  }
  objc_setAssociatedObject(self, &InterpreteOriginalClass, nil, OBJC_ASSOCIATION_ASSIGN);
  object_setClass(self, original);
  [self close];
}
@end
// Keeps keyboard access to the call prompt's checkboxes and buttons.
@interface InterpreteCallPromptPanel : InterpreteOverlayPanel
@end
@implementation InterpreteCallPromptPanel
- (BOOL)canBecomeKeyWindow {
  return YES;
}
@end

// macOS only lets a regular app's NSWindow float over another app's full-screen space when
// that app is active. A non-activating panel can, so the floating windows become one. Tauri's
// window keeps its own instance variables after NSWindow's storage; the swap only happens when
// the panel adds none, so AppKit and Tauri never share memory.
static BOOL InterpreteBecomePanel(NSWindow *native, Class panel) {
  if ([native isKindOfClass:[NSPanel class]] || class_getInstanceSize(panel) != class_getInstanceSize([NSWindow class]))
    return NO;
  objc_setAssociatedObject(native, &InterpreteOriginalClass, object_getClass(native), OBJC_ASSOCIATION_ASSIGN);
  object_setClass(native, panel);
  NSPanel *converted = (NSPanel *)native;
  converted.styleMask |= NSWindowStyleMaskNonactivatingPanel;
  converted.floatingPanel = YES;
  // Setting the style after creation does not update the window server's activation flag.
  SEL prevents = NSSelectorFromString(@"_setPreventsActivation:");
  if ([converted respondsToSelector:prevents]) {
    void (*setPrevents)(id, SEL, BOOL) = (void (*)(id, SEL, BOOL))[converted methodForSelector:prevents];
    setPrevents(converted, prevents, YES);
  }
  return YES;
}

// Called from Tauri setup on the AppKit thread, before the captions or the pill can be shown.
void interprete_configure_overlay(void *window) {
  NSWindow *native = (__bridge NSWindow *)window;
  InterpreteBecomePanel(native, [InterpreteOverlayPanel class]);
  native.hidesOnDeactivate = NO;
  native.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary
      | NSWindowCollectionBehaviorStationary | NSWindowCollectionBehaviorIgnoresCycle;
  native.level = NSFloatingWindowLevel;
}

// Borderless windows grow a rectangular shadow again when shown or resized. Drop it, and the
// webview's opaque plate, so only the rounded card is visible.
static void InterpreteClearPromptChrome(NSWindow *native) {
  native.opaque = NO;
  native.backgroundColor = NSColor.clearColor;
  native.hasShadow = NO;
  NSView *content = native.contentView;
  if (!content) {
    [native invalidateShadow];
    return;
  }
  content.wantsLayer = YES;
  content.layer.backgroundColor = NSColor.clearColor.CGColor;
  content.layer.shadowOpacity = 0;
  Class webviewClass = NSClassFromString(@"WKWebView");
  for (NSView *view in content.subviews) {
    view.wantsLayer = YES;
    view.layer.backgroundColor = NSColor.clearColor.CGColor;
    view.layer.shadowOpacity = 0;
    if (webviewClass && [view isKindOfClass:webviewClass]) {
      @try {
        [view setValue:@NO forKey:@"drawsBackground"];
      } @catch (__unused NSException *exception) {
      }
    }
  }
  [native invalidateShadow];
}

void interprete_configure_call_prompt(void *window) {
  NSWindow *native = (__bridge NSWindow *)window;
  if (InterpreteBecomePanel(native, [InterpreteCallPromptPanel class]))
    ((NSPanel *)native).becomesKeyOnlyIfNeeded = NO;
  native.hidesOnDeactivate = NO;
  native.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary
      | NSWindowCollectionBehaviorStationary | NSWindowCollectionBehaviorIgnoresCycle;
  // Above floating call controls, below system alerts and menus.
  native.level = NSStatusWindowLevel;
  InterpreteClearPromptChrome(native);
}

// Shows the call prompt in the top-right corner of the screen under the pointer, sliding in
// from the right edge. Never takes keyboard focus from the call. Runs on the AppKit thread.
void interprete_present_call_prompt(void *window) {
  NSWindow *native = (__bridge NSWindow *)window;
  InterpreteClearPromptChrome(native);
  if (native.isVisible) {
    [native orderFrontRegardless];
    InterpreteClearPromptChrome(native);
    return;
  }
  NSPoint pointer = NSEvent.mouseLocation;
  NSScreen *screen = NSScreen.mainScreen;
  for (NSScreen *candidate in NSScreen.screens) {
    if (NSPointInRect(pointer, candidate.frame)) {
      screen = candidate;
      break;
    }
  }
  if (!screen) {
    [native orderFrontRegardless];
    InterpreteClearPromptChrome(native);
    return;
  }
  NSRect area = screen.visibleFrame;
  NSSize size = native.frame.size;
  // The window matches the card, so this inset is the gap between the card and the screen corner.
  NSRect target = NSMakeRect(NSMaxX(area) - size.width - 8, NSMaxY(area) - size.height - 8, size.width, size.height);
  NSRect start = target;
  BOOL reduceMotion = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion;
  if (!reduceMotion) {
    // Enter from just past the screen edge, or from nearby when another display sits there.
    start.origin.x = NSMaxX(screen.frame);
    for (NSScreen *other in NSScreen.screens) {
      if (other != screen && NSIntersectsRect(other.frame, start)) {
        start.origin.x = target.origin.x + 48;
        break;
      }
    }
  }
  [native setFrame:start display:NO];
  native.alphaValue = 0;
  [native orderFrontRegardless];
  InterpreteClearPromptChrome(native);
  [NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
    context.duration = reduceMotion ? 0.2 : 0.38;
    context.timingFunction = [CAMediaTimingFunction functionWithControlPoints:0.22 :1 :0.36 :1];
    [native.animator setFrame:target display:YES];
    native.animator.alphaValue = 1;
  } completionHandler:^{
    // Resizing the window puts the rectangular shadow back.
    InterpreteClearPromptChrome(native);
  }];
}
