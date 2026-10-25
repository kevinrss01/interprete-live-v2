#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#include <string.h>

// Only a boolean and permission state leave this bridge. No page text or meeting URL is retained.
static id attribute(AXUIElementRef element, CFStringRef name) {
  CFTypeRef value = NULL;
  if (AXUIElementCopyAttributeValue(element, name, &value) != kAXErrorSuccess) return nil;
  return CFBridgingRelease(value);
}
void interprete_request_call_accessibility(void) {
  // Invoked only by the user's explicit permissions button, never by background polling.
  NSDictionary *options = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt: @YES};
  AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
}
static NSString *text(id value) { return [value isKindOfClass:NSString.class] ? value : @""; }

// Exact own-microphone actions, never "Mute participant", "Mute tab", or "Microphone settings".
int interprete_microphone_action(const char *utf8) {
  NSString *label = [[NSString stringWithUTF8String:utf8] lowercaseString];
  for (NSString *action in @[@"turn on microphone", @"activer le micro", @"activer le microphone", @"unmute my audio"]) {
    if ([label isEqual:action] || [label hasPrefix:[action stringByAppendingString:@" ("]]) return 1;
  }
  for (NSString *action in @[@"turn off microphone", @"désactiver le micro", @"désactiver le microphone", @"mute my audio"]) {
    if ([label isEqual:action] || [label hasPrefix:[action stringByAppendingString:@" ("]]) return 0;
  }
  return -1;
}

static BOOL is_meet(id value) {
  NSURL *url = [value isKindOfClass:NSURL.class] ? value : [NSURL URLWithString:text(value)];
  return [url.host.lowercaseString isEqual:@"meet.google.com"];
}
static BOOL is_blank(id value) {
  return [text(value) isEqual:@"about:blank"] || ([value isKindOfClass:NSURL.class] && [[value absoluteString] isEqual:@"about:blank"]);
}

// Bounded, read-only traversal. A page must be a Meet document and have its leave-call control.
// Ambiguous windows or unreadable controls return unknown, so the caller pauses instead of guessing.
static NSNumber *meet_mute(AXUIElementRef root, CFAbsoluteTime deadline) {
  NSMutableArray *queue = [NSMutableArray arrayWithObject:(__bridge id)root];
  BOOL inCall = NO;
  NSMutableArray<NSNumber *> *states = [NSMutableArray array];
  for (NSUInteger index = 0; index < queue.count && index < 1800; index++) {
    if (CFAbsoluteTimeGetCurrent() > deadline) return nil;
    AXUIElementRef element = (__bridge AXUIElementRef)queue[index];
    CFArrayRef raw = NULL;
    NSArray *keys = @[(__bridge id)kAXRoleAttribute, (__bridge id)kAXChildrenAttribute,
      (__bridge id)kAXTitleAttribute, (__bridge id)kAXDescriptionAttribute];
    if (AXUIElementCopyMultipleAttributeValues(element, (__bridge CFArrayRef)keys, 0, &raw) != kAXErrorSuccess || !raw) continue;
    NSArray *values = CFBridgingRelease(raw);
    if (values.count != keys.count) continue;
    if ([text(values[0]) isEqual:(__bridge NSString *)kAXButtonRole]) {
      NSNumber *state = nil;
      for (id value in @[values[2], values[3]]) {
        NSString *label = text(value);
        int action = interprete_microphone_action(label.UTF8String);
        if (action >= 0) {
          if (state && state.boolValue != (action == 1)) return nil;
          state = action == 1 ? @YES : @NO;
        }
        if ([label isEqual:@"Leave call"] || [label isEqual:@"Quitter l'appel"] || [label isEqual:@"Quitter l’appel"]) inCall = YES;
      }
      if (state) [states addObject:state];
    }
    if ([values[1] isKindOfClass:NSArray.class] && queue.count < 3600) [queue addObjectsFromArray:values[1]];
  }
  return inCall && states.count == 1 ? states[0] : nil;
}

char *interprete_meet_microphone(const char *prefixes_json) {
  @autoreleasepool {
    BOOL trusted = AXIsProcessTrusted();
    NSMutableDictionary *result = [@{@"supported": @YES, @"permissionRequired": trusted ? @NO : @YES, @"muted": NSNull.null} mutableCopy];
    if (trusted) {
      NSData *data = [[NSString stringWithUTF8String:prefixes_json] dataUsingEncoding:NSUTF8StringEncoding];
      NSArray *prefixes = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
      NSMutableArray<NSNumber *> *states = [NSMutableArray array];
      CFAbsoluteTime deadline = CFAbsoluteTimeGetCurrent() + 0.3;
      for (NSRunningApplication *app in NSWorkspace.sharedWorkspace.runningApplications) {
        BOOL matches = NO;
        for (NSString *prefix in prefixes) if ([app.bundleIdentifier.lowercaseString hasPrefix:prefix]) matches = YES;
        if (!matches || app.activationPolicy != NSApplicationActivationPolicyRegular) continue;
        AXUIElementRef root = AXUIElementCreateApplication(app.processIdentifier);
        AXUIElementSetMessagingTimeout(root, 0.08);
        // Chromium builds web accessibility lazily. Request its documented assistive interface
        // once per process launch; macOS Accessibility permission is still required above.
        if (![app.bundleIdentifier.lowercaseString isEqual:@"com.apple.safari"]) {
          static NSMutableSet *requested;
          static dispatch_once_t once;
          dispatch_once(&once, ^{ requested = [NSMutableSet set]; });
          NSString *key = [NSString stringWithFormat:@"%d:%f", app.processIdentifier, app.launchDate.timeIntervalSince1970];
          @synchronized(requested) {
            if (![requested containsObject:key]) {
              id enhanced = attribute(root, CFSTR("AXEnhancedUserInterface"));
              if (![enhanced respondsToSelector:@selector(boolValue)] || ![enhanced boolValue])
                AXUIElementSetAttributeValue(root, CFSTR("AXEnhancedUserInterface"), kCFBooleanTrue);
              [requested addObject:key];
            }
          }
        }
        NSArray *windows = attribute(root, kAXWindowsAttribute);
        if ([windows isKindOfClass:NSArray.class]) for (id window in windows) {
          NSMutableArray *queue = [NSMutableArray arrayWithObject:window];
          NSMutableArray *floatingDocuments = [NSMutableArray array];
          BOOL meetOrigin = NO, backToTab = NO;
          for (NSUInteger index = 0; index < queue.count && index < 500; index++) {
            if (CFAbsoluteTimeGetCurrent() > deadline) break;
            AXUIElementRef element = (__bridge AXUIElementRef)queue[index];
            NSString *role = text(attribute(element, kAXRoleAttribute));
            if ([role isEqual:(__bridge NSString *)kAXStaticTextRole] && [text(attribute(element, kAXValueAttribute)) isEqual:@"meet.google.com"]) meetOrigin = YES;
            if ([role isEqual:(__bridge NSString *)kAXButtonRole]) {
              NSString *label = text(attribute(element, kAXTitleAttribute));
              if (!label.length) label = text(attribute(element, kAXDescriptionAttribute));
              if ([label isEqual:@"Back to tab"] || [label isEqual:@"Revenir à l'onglet"] || [label isEqual:@"Revenir à l’onglet"]) backToTab = YES;
            }
            if ([role isEqual:@"AXWebArea"]) {
              id url = attribute(element, kAXURLAttribute);
              id document = attribute(element, kAXDocumentAttribute);
              if (is_meet(url) || is_meet(document)) {
                NSNumber *muted = meet_mute(element, deadline);
                if (muted) [states addObject:muted];
              } else if (is_blank(url) || is_blank(document))
                [floatingDocuments addObject:(__bridge id)element];
              continue; // Other pages and their contents are never inspected.
            }
            NSArray *children = attribute(element, kAXChildrenAttribute);
            if ([children isKindOfClass:NSArray.class] && queue.count < 1000) [queue addObjectsFromArray:children];
          }
          // Chrome's document picture-in-picture exposes about:blank. Its native origin bar
          // and "Back to tab" button identify Meet; page content alone cannot authorize this path.
          if (meetOrigin && backToTab) for (id document in floatingDocuments) {
            NSNumber *muted = meet_mute((__bridge AXUIElementRef)document, deadline);
            if (muted) [states addObject:muted];
          }
        }
        CFRelease(root);
      }
      if (states.count == 1 && CFAbsoluteTimeGetCurrent() <= deadline) result[@"muted"] = states[0];
    }
    NSData *json = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
    return strdup([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
  }
}
