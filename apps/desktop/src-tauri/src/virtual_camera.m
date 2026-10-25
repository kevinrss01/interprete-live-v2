#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <AppKit/AppKit.h>
#import <CoreImage/CoreImage.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreMediaIO/CMIOHardware.h>
#import <CoreText/CoreText.h>
#import <CoreVideo/CoreVideo.h>
#import <ImageIO/ImageIO.h>
#import <IOKit/audio/IOAudioTypes.h>
#import <QuartzCore/QuartzCore.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

// The relay sends the composed frames to the sink stream of OBS Virtual Camera. That camera
// extension is signed by OBS, accepts frames from any app, and works while OBS is closed. A new
// system camera would need an extension signed by a paid Apple Developer team.
static NSString *const InterpreteSinkCameraUID = @"7626645E-4425-469E-9D8B-97E0FA59AC75";
static NSString *const InterpreteSinkCameraName = @"OBS Virtual Camera";
static NSString *const InterpreteSinkCameraApp = @"com.obsproject.obs-studio";
// The extension's only format. Others forward what they receive, so match it exactly.
static const size_t InterpreteFrameWidth = 1920;
static const size_t InterpreteFrameHeight = 1080;
static NSString *const InterpreteSyntheticCamera = @"@synthetic";

static char *InterpreteCopyString(NSString *value) {
  return value ? strdup(value.UTF8String) : NULL;
}
static char *InterpreteCopyJSON(id object) {
  NSData *json = [NSJSONSerialization dataWithJSONObject:object options:0 error:nil];
  return json ? strdup([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String) : NULL;
}

#pragma mark - Virtual camera sink

static NSString *InterpreteCMIOString(CMIOObjectID object, CMIOObjectPropertySelector selector) {
  CMIOObjectPropertyAddress address = {selector, kCMIOObjectPropertyScopeGlobal, kCMIOObjectPropertyElementMain};
  CFStringRef value = NULL;
  UInt32 used = 0;
  if (CMIOObjectGetPropertyData(object, &address, 0, NULL, sizeof(value), &used, &value) != noErr || !value) return nil;
  return CFBridgingRelease(value);
}
static NSData *InterpreteCMIOList(CMIOObjectID object, CMIOObjectPropertySelector selector) {
  CMIOObjectPropertyAddress address = {selector, kCMIOObjectPropertyScopeGlobal, kCMIOObjectPropertyElementMain};
  UInt32 size = 0, used = 0;
  if (CMIOObjectGetPropertyDataSize(object, &address, 0, NULL, &size) != noErr || size == 0) return nil;
  NSMutableData *data = [NSMutableData dataWithLength:size];
  if (CMIOObjectGetPropertyData(object, &address, 0, NULL, size, &used, data.mutableBytes) != noErr) return nil;
  data.length = used;
  return data;
}
// The stream that receives frames: CoreMediaIO calls it an input stream (direction 1).
static CMIOStreamID InterpreteSinkStream(CMIOObjectID device) {
  NSData *streams = InterpreteCMIOList(device, kCMIODevicePropertyStreams);
  const CMIOStreamID *ids = streams.bytes;
  NSUInteger count = streams.length / sizeof(CMIOStreamID);
  for (NSUInteger index = 0; index < count; index++) {
    CMIOObjectPropertyAddress address = {kCMIOStreamPropertyDirection, kCMIOObjectPropertyScopeGlobal, kCMIOObjectPropertyElementMain};
    UInt32 direction = 0, used = 0;
    if (CMIOObjectGetPropertyData(ids[index], &address, 0, NULL, sizeof(direction), &used, &direction) == noErr && direction == 1)
      return ids[index];
  }
  return kCMIOObjectUnknown;
}
static CMIOObjectID InterpreteSinkDevice(void) {
  NSData *devices = InterpreteCMIOList(kCMIOObjectSystemObject, kCMIOHardwarePropertyDevices);
  const CMIOObjectID *ids = devices.bytes;
  NSUInteger count = devices.length / sizeof(CMIOObjectID);
  for (NSUInteger index = 0; index < count; index++) {
    NSString *uid = InterpreteCMIOString(ids[index], kCMIODevicePropertyDeviceUID);
    NSString *name = InterpreteCMIOString(ids[index], kCMIOObjectPropertyName);
    BOOL known = [uid caseInsensitiveCompare:InterpreteSinkCameraUID] == NSOrderedSame || [name isEqualToString:InterpreteSinkCameraName];
    if (known && InterpreteSinkStream(ids[index]) != kCMIOObjectUnknown) return ids[index];
  }
  return kCMIOObjectUnknown;
}

@interface InterpreteCameraSink : NSObject
@property(nonatomic, readonly) CMIOObjectID device;
@property(nonatomic, readonly) NSString *uid;
@property(nonatomic, readonly) uint64_t delivered;
@end

// Frames the extension took from a queue. A callback can still be running after its stream is
// closed, so it touches only this process-wide counter, never a sink that may be gone.
static _Atomic uint64_t InterpreteSinkTaken;
static void InterpreteSinkAltered(__unused CMIOStreamID stream, __unused void *token, __unused void *refcon) {
  atomic_fetch_add_explicit(&InterpreteSinkTaken, 1, memory_order_relaxed);
}
static void InterpreteSinkUnregister(CMIOStreamID stream) {
  CMSimpleQueueRef queue = NULL;
  if (CMIOStreamCopyBufferQueue(stream, NULL, NULL, &queue) == noErr && queue) CFRelease(queue);
}

@implementation InterpreteCameraSink {
  CMIOStreamID _stream;
  CMSimpleQueueRef _queue;
  CMVideoFormatDescriptionRef _format;
  uint64_t _takenAtStart;
}
+ (instancetype)connect:(NSString **)error {
  CMIOObjectID device = InterpreteSinkDevice();
  if (device == kCMIOObjectUnknown) {
    *error = @"OBS Virtual Camera is not available. Install OBS, start its virtual camera once, and allow its extension.";
    return nil;
  }
  InterpreteCameraSink *sink = [InterpreteCameraSink new];
  sink->_device = device;
  sink->_uid = InterpreteCMIOString(device, kCMIODevicePropertyDeviceUID) ?: @"";
  sink->_stream = InterpreteSinkStream(device);
  sink->_takenAtStart = atomic_load_explicit(&InterpreteSinkTaken, memory_order_relaxed);
  OSStatus status = CMIOStreamCopyBufferQueue(sink->_stream, InterpreteSinkAltered, NULL, &sink->_queue);
  if (status != noErr || !sink->_queue) {
    InterpreteSinkUnregister(sink->_stream);
    sink->_queue = NULL;
    *error = [NSString stringWithFormat:@"OBS Virtual Camera refused the connection (CoreMediaIO %d).", (int)status];
    return nil;
  }
  status = CMIODeviceStartStream(device, sink->_stream);
  if (status != noErr) {
    InterpreteSinkUnregister(sink->_stream);
    CFRelease(sink->_queue);
    sink->_queue = NULL;
    *error = [NSString stringWithFormat:@"OBS Virtual Camera could not start (CoreMediaIO %d).", (int)status];
    return nil;
  }
  return sink;
}
- (uint64_t)delivered {
  return atomic_load_explicit(&InterpreteSinkTaken, memory_order_relaxed) - _takenAtStart;
}
// Ownership of the sample buffer passes to the queue; a full queue drops the frame.
- (BOOL)send:(CVPixelBufferRef)buffer {
  if (!_queue) return NO;
  if (CMSimpleQueueGetCount(_queue) >= CMSimpleQueueGetCapacity(_queue)) return NO;
  if (!_format && CMVideoFormatDescriptionCreateForImageBuffer(kCFAllocatorDefault, buffer, &_format) != noErr) return NO;
  CMSampleTimingInfo timing = {
    .duration = CMTimeMake(1, 30),
    .presentationTimeStamp = CMClockGetTime(CMClockGetHostTimeClock()),
    .decodeTimeStamp = kCMTimeInvalid,
  };
  CMSampleBufferRef sample = NULL;
  if (CMSampleBufferCreateReadyWithImageBuffer(kCFAllocatorDefault, buffer, _format, &timing, &sample) != noErr || !sample) return NO;
  if (CMSimpleQueueEnqueue(_queue, sample) != noErr) {
    CFRelease(sample);
    return NO;
  }
  return YES;
}
- (void)close {
  if (_queue) {
    InterpreteSinkUnregister(_stream);
    CMIODeviceStopStream(_device, _stream);
    CFRelease(_queue);
    _queue = NULL;
  }
  if (_format) {
    CFRelease(_format);
    _format = NULL;
  }
}
- (void)dealloc {
  [self close];
}
@end

#pragma mark - Captions

// Captions drawn like the call captions window: light text on a dark, rounded backdrop.
// Live speech rolls upward: when the passage needs more than two lines, the last two remain.
static CGImageRef InterpreteCreateCaptionImage(NSString *text, size_t width, size_t height, CGFloat *outHeight) {
  CGFloat fontSize = round(height * 0.054);
  CGFloat maxWidth = round(width * 0.8);
  CGFloat padX = round(fontSize * 0.55), padY = round(fontSize * 0.3);
  CGFloat lineHeight = round(fontSize * 1.24);
  NSFont *font = [NSFont systemFontOfSize:fontSize weight:NSFontWeightSemibold];
  NSColor *ink = [NSColor colorWithSRGBRed:0.980 green:0.980 blue:0.976 alpha:1];
  NSMutableParagraphStyle *paragraph = [NSMutableParagraphStyle new];
  paragraph.lineBreakMode = NSLineBreakByWordWrapping;
  NSAttributedString *string = [[NSAttributedString alloc] initWithString:text attributes:@{
    NSFontAttributeName: font,
    NSForegroundColorAttributeName: ink,
    NSParagraphStyleAttributeName: paragraph,
  }];
  CTFramesetterRef framesetter = CTFramesetterCreateWithAttributedString((__bridge CFAttributedStringRef)string);
  CGPathRef path = CGPathCreateWithRect(CGRectMake(0, 0, maxWidth - 2 * padX, 100000), NULL);
  CTFrameRef frame = CTFramesetterCreateFrame(framesetter, CFRangeMake(0, 0), path, NULL);
  CGPathRelease(path);
  CFRelease(framesetter);
  NSArray *all = (__bridge NSArray *)CTFrameGetLines(frame);
  NSArray *lines = all.count > 2 ? [all subarrayWithRange:NSMakeRange(all.count - 2, 2)] : all;
  if (!lines.count) {
    CFRelease(frame);
    return NULL;
  }
  CGFloat widest = 0;
  NSMutableArray<NSNumber *> *widths = [NSMutableArray array];
  for (id line in lines) {
    CTLineRef ref = (__bridge CTLineRef)line;
    CGFloat lineWidth = CTLineGetTypographicBounds(ref, NULL, NULL, NULL) - CTLineGetTrailingWhitespaceWidth(ref);
    [widths addObject:@(lineWidth)];
    widest = MAX(widest, lineWidth);
  }
  CGFloat boxWidth = ceil(widest + 2 * padX);
  CGFloat boxHeight = ceil(lines.count * lineHeight + 2 * padY);
  CGFloat bottom = round(height * 0.065);
  size_t imageHeight = (size_t)(boxHeight + bottom + 8);
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(NULL, width, imageHeight, 8, 0, space,
                                               kCGImageAlphaPremultipliedFirst | kCGBitmapByteOrder32Little);
  CGColorSpaceRelease(space);
  if (!context) {
    CFRelease(frame);
    return NULL;
  }
  CGContextSetShouldSmoothFonts(context, false);
  CGContextSetShouldAntialias(context, true);
  CGRect box = CGRectMake(round((width - boxWidth) / 2), bottom, boxWidth, boxHeight);
  CGFloat radius = round(fontSize * 0.34);
  CGPathRef backdrop = CGPathCreateWithRoundedRect(box, radius, radius, NULL);
  CGContextAddPath(context, backdrop);
  CGContextSetRGBFillColor(context, 22 / 255.0, 22 / 255.0, 21 / 255.0, 0.8);
  CGContextFillPath(context);
  CGPathRelease(backdrop);
  CGContextSetShadowWithColor(context, CGSizeMake(0, -1), 2, [NSColor colorWithWhite:0 alpha:0.35].CGColor);
  CGFloat ascent = font.ascender, descent = -font.descender;
  CGFloat baseline = box.origin.y + box.size.height - padY - (lineHeight - (ascent + descent)) / 2 - ascent;
  for (NSUInteger index = 0; index < lines.count; index++) {
    CTLineRef line = (__bridge CTLineRef)lines[index];
    CGFloat x = round((width - widths[index].doubleValue) / 2);
    CGContextSetTextPosition(context, x, round(baseline - index * lineHeight));
    CTLineDraw(line, context);
  }
  CGImageRef image = CGBitmapContextCreateImage(context);
  CGContextRelease(context);
  CFRelease(frame);
  if (outHeight) *outHeight = imageHeight;
  return image;
}

#pragma mark - Relay

@interface InterpreteCameraRelay : NSObject <AVCaptureVideoDataOutputSampleBufferDelegate>
@end

@implementation InterpreteCameraRelay {
  dispatch_queue_t _queue;
  AVCaptureSession *_session;
  dispatch_source_t _synthetic;
  dispatch_source_t _watchdog;
  InterpreteCameraSink *_sink;
  CIContext *_context;
  CVPixelBufferPoolRef _pool;
  CGColorSpaceRef _space;
  NSString *_cameraName;
  NSString *_cameraUID;
  NSString *_error;
  NSString *_caption;
  CIImage *_overlay;
  CGFloat _alpha;
  CFTimeInterval _lastFrameAt;
  CFTimeInterval _lastSentAt;
  CFTimeInterval _startedAt;
  uint64_t _frames;
  uint64_t _sent;
  CVPixelBufferRef _latest;
  NSMutableArray<id> *_observers;
}
- (instancetype)init {
  if ((self = [super init])) {
    _queue = dispatch_queue_create("ai.impulselab.interprete.camera", DISPATCH_QUEUE_SERIAL);
    _space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    _context = [CIContext contextWithOptions:@{
      kCIContextWorkingColorSpace: (__bridge id)_space,
      kCIContextCacheIntermediates: @NO,
    }];
    NSDictionary *attributes = @{
      (id)kCVPixelBufferPixelFormatTypeKey: @(kCVPixelFormatType_32BGRA),
      (id)kCVPixelBufferWidthKey: @(InterpreteFrameWidth),
      (id)kCVPixelBufferHeightKey: @(InterpreteFrameHeight),
      (id)kCVPixelBufferIOSurfacePropertiesKey: @{},
    };
    CVPixelBufferPoolCreate(kCFAllocatorDefault, (__bridge CFDictionaryRef)@{(id)kCVPixelBufferPoolMinimumBufferCountKey: @6},
                            (__bridge CFDictionaryRef)attributes, &_pool);
    _caption = @"";
    _observers = [NSMutableArray array];
  }
  return self;
}
- (void)dealloc {
  for (id observer in _observers) [NSNotificationCenter.defaultCenter removeObserver:observer];
  if (_latest) CVPixelBufferRelease(_latest);
  if (_pool) CVPixelBufferPoolRelease(_pool);
  if (_space) CGColorSpaceRelease(_space);
}
// Without the sink, frames are only composed: tests use it so they never reach a real call.
- (NSString *)startWithCamera:(NSString *)cameraId connectSink:(BOOL)connectSink {
  NSString *error = nil;
  if (!_pool) return @"Unable to prepare the video frames.";
  if (connectSink && !(_sink = [InterpreteCameraSink connect:&error])) return error;
  _startedAt = CACurrentMediaTime();
  _lastSentAt = _startedAt;
  if ([cameraId isEqualToString:InterpreteSyntheticCamera]) {
    _cameraName = @"Synthetic test pattern";
    [self startSynthetic];
  } else if ((error = [self startCamera:cameraId])) {
    [self stop];
    return error;
  }
  [self startWatchdog];
  return nil;
}
- (NSString *)startCamera:(NSString *)cameraId {
  AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo];
  if (status != AVAuthorizationStatusAuthorized)
    return @"Camera access is off. Allow Interprète in System Settings › Privacy & Security › Camera.";
  AVCaptureDevice *device = [AVCaptureDevice deviceWithUniqueID:cameraId];
  if (!device) return @"This camera is no longer connected. Choose another camera.";
  if ((_sink.uid.length && [device.uniqueID caseInsensitiveCompare:_sink.uid] == NSOrderedSame) ||
      [device.uniqueID caseInsensitiveCompare:InterpreteSinkCameraUID] == NSOrderedSame)
    return @"Choose your physical camera, not the virtual camera.";
  NSError *failure = nil;
  AVCaptureDeviceInput *input = [AVCaptureDeviceInput deviceInputWithDevice:device error:&failure];
  if (!input) return failure.localizedDescription ?: @"The camera could not be opened.";
  AVCaptureSession *session = [AVCaptureSession new];
  [session beginConfiguration];
  if (![session canAddInput:input]) {
    [session commitConfiguration];
    return @"The camera is not available. Close other apps using it, then try again.";
  }
  [session addInput:input];
  for (AVCaptureSessionPreset preset in @[AVCaptureSessionPreset1920x1080, AVCaptureSessionPreset1280x720, AVCaptureSessionPresetHigh]) {
    if ([session canSetSessionPreset:preset]) {
      session.sessionPreset = preset;
      break;
    }
  }
  AVCaptureVideoDataOutput *output = [AVCaptureVideoDataOutput new];
  output.videoSettings = @{(id)kCVPixelBufferPixelFormatTypeKey: @(kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange)};
  output.alwaysDiscardsLateVideoFrames = YES;
  [output setSampleBufferDelegate:self queue:_queue];
  if (![session canAddOutput:output]) {
    [session commitConfiguration];
    return @"The camera image cannot be read.";
  }
  [session addOutput:output];
  [session commitConfiguration];
  __weak InterpreteCameraRelay *weak = self;
  [_observers addObject:[NSNotificationCenter.defaultCenter addObserverForName:AVCaptureSessionRuntimeErrorNotification object:session queue:nil usingBlock:^(NSNotification *note) {
    NSError *runtime = note.userInfo[AVCaptureSessionErrorKey];
    [weak fail:runtime.localizedDescription ?: @"The camera stopped unexpectedly."];
  }]];
  [_observers addObject:[NSNotificationCenter.defaultCenter addObserverForName:AVCaptureDeviceWasDisconnectedNotification object:device queue:nil usingBlock:^(__unused NSNotification *note) {
    [weak fail:@"The camera was disconnected."];
  }]];
  _session = session;
  _cameraName = device.localizedName;
  _cameraUID = device.uniqueID;
  [session startRunning];
  if (!session.isRunning) return @"The camera did not start. Close other apps using it, then try again.";
  return nil;
}
// A moving pattern with the same pipeline as a camera, for checks that must not open one.
- (void)startSynthetic {
  _synthetic = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, _queue);
  dispatch_source_set_timer(_synthetic, dispatch_time(DISPATCH_TIME_NOW, 0), NSEC_PER_SEC / 30, NSEC_PER_MSEC);
  __weak InterpreteCameraRelay *weak = self;
  dispatch_source_set_event_handler(_synthetic, ^{
    InterpreteCameraRelay *relay = weak;
    if (!relay) return;
    CGFloat phase = fmod(CACurrentMediaTime() - relay->_startedAt, 4.0) / 4.0;
    CIImage *gradient = [CIFilter filterWithName:@"CILinearGradient" withInputParameters:@{
      @"inputPoint0": [CIVector vectorWithX:0 Y:0],
      @"inputPoint1": [CIVector vectorWithX:InterpreteFrameWidth Y:InterpreteFrameHeight],
      @"inputColor0": [CIColor colorWithRed:0.18 green:0.29 blue:0.36],
      @"inputColor1": [CIColor colorWithRed:0.77 green:0.69 blue:0.58],
    }].outputImage;
    CIImage *bar = [[CIImage imageWithColor:[CIColor colorWithRed:0.95 green:0.95 blue:0.93 alpha:0.9]]
        imageByCroppingToRect:CGRectMake(phase * (InterpreteFrameWidth - 120), 0, 120, InterpreteFrameHeight)];
    CIImage *frame = [[bar imageByCompositingOverImage:gradient] imageByCroppingToRect:CGRectMake(0, 0, InterpreteFrameWidth, InterpreteFrameHeight)];
    [relay compose:frame];
  });
  dispatch_resume(_synthetic);
}
- (void)startWatchdog {
  _watchdog = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, _queue);
  dispatch_source_set_timer(_watchdog, dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), NSEC_PER_SEC, NSEC_PER_SEC / 10);
  __weak InterpreteCameraRelay *weak = self;
  dispatch_source_set_event_handler(_watchdog, ^{
    InterpreteCameraRelay *relay = weak;
    if (!relay || relay->_error) return;
    CFTimeInterval now = CACurrentMediaTime();
    CFTimeInterval reference = relay->_frames ? relay->_lastFrameAt : relay->_startedAt;
    if (now - reference > 5)
      relay->_error = relay->_frames ? @"The camera stopped sending images." : @"The camera sends no image. Close other apps using it, then try again.";
    // The extension takes frames continuously while its sink runs; a full queue means it is gone.
    else if (relay->_sink && relay->_frames && now - relay->_lastSentAt > 5)
      relay->_error = @"OBS Virtual Camera stopped taking images. Start the video again.";
  });
  dispatch_resume(_watchdog);
}
- (void)fail:(NSString *)message {
  dispatch_async(_queue, ^{
    if (!self->_error) self->_error = message;
  });
}
- (void)captureOutput:(AVCaptureOutput *)output didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer fromConnection:(AVCaptureConnection *)connection {
  CVImageBufferRef image = CMSampleBufferGetImageBuffer(sampleBuffer);
  if (image) [self compose:[CIImage imageWithCVImageBuffer:image]];
}
// Runs on the relay queue: fit the camera to the output, draw the caption, send the frame.
- (void)compose:(CIImage *)camera {
  CFTimeInterval now = CACurrentMediaTime();
  CFTimeInterval elapsed = _lastFrameAt ? MIN(now - _lastFrameAt, 0.1) : 0;
  _lastFrameAt = now;
  _frames += 1;
  CGFloat width = InterpreteFrameWidth, height = InterpreteFrameHeight;
  CGRect extent = camera.extent;
  if (CGRectIsEmpty(extent) || CGRectIsInfinite(extent)) return;
  CGFloat scale = MAX(width / extent.size.width, height / extent.size.height);
  CIImage *fitted = [camera imageByApplyingTransform:CGAffineTransformMakeScale(scale, scale)];
  CGRect scaled = fitted.extent;
  fitted = [[fitted imageByApplyingTransform:CGAffineTransformMakeTranslation(
      -scaled.origin.x - (scaled.size.width - width) / 2, -scaled.origin.y - (scaled.size.height - height) / 2)]
      imageByCroppingToRect:CGRectMake(0, 0, width, height)];
  // Fade in quickly when words arrive, out more slowly when the caption clears.
  CGFloat target = _caption.length ? 1 : 0;
  CGFloat rate = target > _alpha ? 1 / 0.16 : 1 / 0.32;
  _alpha = target > _alpha ? MIN(target, _alpha + elapsed * rate) : MAX(target, _alpha - elapsed * rate);
  if (_frames == 1) _alpha = target;
  if (_overlay && _alpha > 0.004) {
    CIImage *overlay = _alpha < 0.996
        ? [_overlay imageByApplyingFilter:@"CIColorMatrix" withInputParameters:@{@"inputAVector": [CIVector vectorWithX:0 Y:0 Z:0 W:_alpha]}]
        : _overlay;
    fitted = [overlay imageByCompositingOverImage:fitted];
  } else if (!_caption.length) {
    _overlay = nil;
  }
  CVPixelBufferRef output = NULL;
  NSDictionary *limit = @{(id)kCVPixelBufferPoolAllocationThresholdKey: @12};
  if (CVPixelBufferPoolCreatePixelBufferWithAuxAttributes(kCFAllocatorDefault, _pool, (__bridge CFDictionaryRef)limit, &output) != kCVReturnSuccess || !output)
    return;
  CVBufferSetAttachment(output, kCVImageBufferCGColorSpaceKey, _space, kCVAttachmentMode_ShouldPropagate);
  [_context render:fitted toCVPixelBuffer:output bounds:CGRectMake(0, 0, width, height) colorSpace:_space];
  if ([_sink send:output]) {
    _sent += 1;
    _lastSentAt = now;
  }
  if (_latest) CVPixelBufferRelease(_latest);
  _latest = output;
}
- (void)setCaption:(NSString *)text {
  dispatch_async(_queue, ^{
    if ([text isEqualToString:self->_caption]) return;
    self->_caption = text;
    if (!text.length) return; // The previous image fades out.
    CGFloat height = 0;
    CGImageRef image = InterpreteCreateCaptionImage(text, InterpreteFrameWidth, InterpreteFrameHeight, &height);
    self->_overlay = image ? [CIImage imageWithCGImage:image] : nil;
    if (image) CGImageRelease(image);
  });
}
- (void)stop {
  if (_watchdog) dispatch_source_cancel(_watchdog);
  if (_synthetic) dispatch_source_cancel(_synthetic);
  _watchdog = nil;
  _synthetic = nil;
  [_session stopRunning];
  _session = nil;
  // Let a frame being composed finish before the stream closes.
  dispatch_sync(_queue, ^{
    [self->_sink close];
    self->_sink = nil;
    self->_cameraUID = nil;
  });
}
- (NSDictionary *)status {
  __block NSDictionary *status;
  dispatch_sync(_queue, ^{
    status = @{
      @"running": @YES,
      @"camera": self->_cameraName ?: @"",
      @"sink": self->_sink ? InterpreteSinkCameraName : [NSNull null],
      @"frames": @(self->_frames),
      @"sent": @(self->_sent),
      @"delivered": @(self->_sink.delivered),
      @"error": self->_error ?: [NSNull null],
    };
  });
  return status;
}
- (NSArray<NSString *> *)devicesInUse {
  __block NSArray *devices;
  dispatch_sync(_queue, ^{
    NSMutableArray *list = [NSMutableArray array];
    if (self->_cameraUID) [list addObject:self->_cameraUID];
    if (self->_sink.uid.length) [list addObject:self->_sink.uid];
    devices = list;
  });
  return devices;
}
- (NSData *)previewJPEG {
  __block CVPixelBufferRef latest = NULL;
  dispatch_sync(_queue, ^{
    if (self->_latest) latest = CVPixelBufferRetain(self->_latest);
  });
  if (!latest) return nil;
  CIImage *image = [CIImage imageWithCVPixelBuffer:latest];
  CGFloat scale = 640.0 / InterpreteFrameWidth;
  image = [image imageByApplyingTransform:CGAffineTransformMakeScale(scale, scale)];
  NSData *jpeg = [_context JPEGRepresentationOfImage:image colorSpace:_space options:@{
    (id)kCGImageDestinationLossyCompressionQuality: @0.72,
  }];
  CVPixelBufferRelease(latest);
  return jpeg;
}
@end

static InterpreteCameraRelay *InterpreteActiveRelay;
// Start and stop are serialized by one lock; readers take another, briefly, so a caption,
// status or call probe never waits for a camera to open.
static NSObject *InterpreteLifecycleLock(void) {
  static NSObject *lock;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ lock = [NSObject new]; });
  return lock;
}
static NSObject *InterpreteRelayLock(void) {
  static NSObject *lock;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ lock = [NSObject new]; });
  return lock;
}
static InterpreteCameraRelay *InterpreteCurrentRelay(void) {
  @synchronized(InterpreteRelayLock()) {
    return InterpreteActiveRelay;
  }
}
static InterpreteCameraRelay *InterpreteSwapRelay(InterpreteCameraRelay *relay) {
  @synchronized(InterpreteRelayLock()) {
    InterpreteCameraRelay *previous = InterpreteActiveRelay;
    InterpreteActiveRelay = relay;
    return previous;
  }
}

#pragma mark - C interface

static NSString *InterpreteAuthorization(void) {
  switch ([AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo]) {
    case AVAuthorizationStatusAuthorized: return @"authorized";
    case AVAuthorizationStatusDenied: return @"denied";
    case AVAuthorizationStatusRestricted: return @"restricted";
    default: return @"notDetermined";
  }
}
// Lists cameras and the virtual camera's state. Reads device metadata only; opens no camera.
char *interprete_camera_devices(void) {
  @autoreleasepool {
    NSMutableArray *types = [NSMutableArray arrayWithObject:AVCaptureDeviceTypeBuiltInWideAngleCamera];
    if (@available(macOS 14.0, *)) {
      [types addObject:AVCaptureDeviceTypeExternal];
      [types addObject:AVCaptureDeviceTypeContinuityCamera];
    } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
      [types addObject:AVCaptureDeviceTypeExternalUnknown];
#pragma clang diagnostic pop
    }
    AVCaptureDeviceDiscoverySession *discovery = [AVCaptureDeviceDiscoverySession discoverySessionWithDeviceTypes:types
        mediaType:AVMediaTypeVideo position:AVCaptureDevicePositionUnspecified];
    NSMutableArray *cameras = [NSMutableArray array];
    for (AVCaptureDevice *device in discovery.devices) {
      // Virtual cameras, including the relay's own destination, cannot be the source.
      if (device.transportType == kIOAudioDeviceTransportTypeVirtual) continue;
      if ([device.uniqueID caseInsensitiveCompare:InterpreteSinkCameraUID] == NSOrderedSame) continue;
      [cameras addObject:@{@"id": device.uniqueID, @"name": device.localizedName}];
    }
    BOOL installed = [NSWorkspace.sharedWorkspace URLForApplicationWithBundleIdentifier:InterpreteSinkCameraApp] != nil;
    BOOL ready = InterpreteSinkDevice() != kCMIOObjectUnknown;
    return InterpreteCopyJSON(@{
      @"authorization": InterpreteAuthorization(),
      @"cameras": cameras,
      @"virtualCamera": @{
        @"name": InterpreteSinkCameraName,
        @"installed": @(installed),
        @"ready": @(ready),
      },
    });
  }
}
// Asks for camera access once; blocks until the person answers. Never call on the main thread.
int interprete_camera_access(void) {
  @autoreleasepool {
    AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo];
    if (status != AVAuthorizationStatusNotDetermined) return status == AVAuthorizationStatusAuthorized;
    dispatch_semaphore_t answered = dispatch_semaphore_create(0);
    __block BOOL granted = NO;
    [AVCaptureDevice requestAccessForMediaType:AVMediaTypeVideo completionHandler:^(BOOL allowed) {
      granted = allowed;
      dispatch_semaphore_signal(answered);
    }];
    dispatch_semaphore_wait(answered, DISPATCH_TIME_FOREVER);
    return granted;
  }
}
// Returns NULL once frames flow, or an owned error message.
char *interprete_camera_relay_start(const char *camera_id, bool connect_sink) {
  @autoreleasepool {
    @synchronized(InterpreteLifecycleLock()) {
      [InterpreteSwapRelay(nil) stop];
      InterpreteCameraRelay *relay = [InterpreteCameraRelay new];
      NSString *error = [relay startWithCamera:[NSString stringWithUTF8String:camera_id] connectSink:connect_sink];
      if (error) return InterpreteCopyString(error);
      InterpreteSwapRelay(relay);
      return NULL;
    }
  }
}
void interprete_camera_relay_caption(const char *text) {
  @autoreleasepool {
    [InterpreteCurrentRelay() setCaption:[NSString stringWithUTF8String:text] ?: @""];
  }
}
void interprete_camera_relay_stop(void) {
  @autoreleasepool {
    @synchronized(InterpreteLifecycleLock()) {
      [InterpreteSwapRelay(nil) stop];
    }
  }
}
char *interprete_camera_relay_status(void) {
  @autoreleasepool {
    InterpreteCameraRelay *relay = InterpreteCurrentRelay();
    return InterpreteCopyJSON(relay ? relay.status : @{@"running": @NO});
  }
}
// The latest composed frame as a small JPEG, owned by the caller; NULL before the first frame.
uint8_t *interprete_camera_relay_preview(size_t *length) {
  @autoreleasepool {
    NSData *jpeg = [InterpreteCurrentRelay() previewJPEG];
    if (!jpeg.length) return NULL;
    uint8_t *bytes = malloc(jpeg.length);
    if (!bytes) return NULL;
    memcpy(bytes, jpeg.bytes, jpeg.length);
    *length = jpeg.length;
    return bytes;
  }
}
// Devices the relay itself keeps running: call detection must not mistake them for a call.
bool interprete_camera_relay_uses(NSString *uid) {
  if (!uid.length) return false;
  for (NSString *device in [InterpreteCurrentRelay() devicesInUse])
    if ([device caseInsensitiveCompare:uid] == NSOrderedSame) return true;
  return false;
}
// Test support: draws a caption over a synthetic frame into a PNG file. Opens no camera.
int interprete_camera_render_caption(const char *text, const char *path) {
  @autoreleasepool {
    CGFloat height = 0;
    CGImageRef caption = InterpreteCreateCaptionImage([NSString stringWithUTF8String:text], InterpreteFrameWidth, InterpreteFrameHeight, &height);
    CIImage *background = [[CIFilter filterWithName:@"CILinearGradient" withInputParameters:@{
      @"inputPoint0": [CIVector vectorWithX:0 Y:0],
      @"inputPoint1": [CIVector vectorWithX:InterpreteFrameWidth Y:InterpreteFrameHeight],
      @"inputColor0": [CIColor colorWithRed:0.92 green:0.91 blue:0.88],
      @"inputColor1": [CIColor colorWithRed:0.35 green:0.42 blue:0.47],
    }].outputImage imageByCroppingToRect:CGRectMake(0, 0, InterpreteFrameWidth, InterpreteFrameHeight)];
    CIImage *frame = caption ? [[CIImage imageWithCGImage:caption] imageByCompositingOverImage:background] : background;
    if (caption) CGImageRelease(caption);
    CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CIContext *context = [CIContext contextWithOptions:nil];
    NSError *error = nil;
    BOOL written = [context writePNGRepresentationOfImage:frame toURL:[NSURL fileURLWithPath:[NSString stringWithUTF8String:path]]
                                                   format:kCIFormatRGBA8 colorSpace:space options:@{} error:&error];
    CGColorSpaceRelease(space);
    return written ? 0 : -1;
  }
}
