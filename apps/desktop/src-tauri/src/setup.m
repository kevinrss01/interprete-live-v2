#import <AVFoundation/AVFoundation.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Foundation/Foundation.h>
#include <string.h>

// Permission metadata only. No capture session is opened and no recording is made.
char *interprete_setup_status(void) {
  @autoreleasepool {
    NSString *microphone = @"unknown";
    switch ([AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio]) {
      case AVAuthorizationStatusAuthorized: microphone = @"granted"; break;
      case AVAuthorizationStatusNotDetermined: microphone = @"not-determined"; break;
      case AVAuthorizationStatusDenied: microphone = @"denied"; break;
      case AVAuthorizationStatusRestricted: microphone = @"restricted"; break;
    }
    BOOL supported = NO;
    if (@available(macOS 14.2, *)) supported = YES;
    NSDictionary *status = @{
      @"supported": supported ? @YES : @NO,
      @"microphone": microphone,
      @"accessibility": AXIsProcessTrusted() ? @YES : @NO,
    };
    NSData *json = [NSJSONSerialization dataWithJSONObject:status options:0 error:nil];
    return strdup([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
  }
}

void interprete_request_setup_microphone(void) {
  [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio completionHandler:^(__unused BOOL granted) {}];
}
