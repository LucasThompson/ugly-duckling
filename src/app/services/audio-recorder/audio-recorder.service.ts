/**
 * Created by lucas on 17/03/2017.
 */
import {Injectable, Inject, NgZone} from '@angular/core';
import {Observable} from 'rxjs/Observable';
import {Subject} from 'rxjs/Subject';
import {NotificationService} from '../notifications/notifications.service';


// seems the TypeScript definitions are not up to date,
// introduce own types for now

export type AudioInputProvider = () => Promise<MediaStream>;

export interface MediaRecorderOptions {
  mimeType?: string;
  audioBitsPerSecond?: number;
  videoBitsPerSecond?: number;
  bitsPerSecond?: number;
}

export type RecordingState = 'inactive' | 'recording' | 'paused';

export interface BlobEvent extends Event {
  readonly data: Blob;
  readonly timecode?: number;
}

export interface MediaRecorderErrorEvent extends Event {
  readonly error: DOMException;
}

export interface MediaRecorder {
  readonly mimeType: string;
  readonly state: RecordingState;
  readonly stream: MediaStream;
  ignoreMutedMedia: boolean;
  readonly videoBitsPerSecond: number;
  readonly audioBitsPerSecond: number;
  // isTypeSupported(mimeType: string): boolean;
  onstart: (evt: Event) => void;
  onstop: (evt: Event) => void;
  ondataavailable: (evt: BlobEvent) => void;
  onpause: (evt: Event) => void;
  onresume: (evt: Event) => void;
  onerror: (evt: MediaRecorderErrorEvent) => void;
  pause(): void;
  requestData(): void;
  resume(): void;
  start(timeslice?: number): void;
  stop(): void;
}

export interface MediaRecorderConstructor {
  new(stream: MediaStream,
      options?: MediaRecorderOptions): MediaRecorder;
  isTypeSupported(mimeType: string): boolean;
}

export type RecorderServiceStatus = 'disabled' | 'enabled' | 'recording';

export class ThrowingMediaRecorder implements MediaRecorder {
  mimeType: string;
  state: RecordingState;
  stream: MediaStream;
  ignoreMutedMedia: boolean;
  videoBitsPerSecond: number;
  audioBitsPerSecond: number;
  onstart: (evt: Event) => void;
  onstop: (evt: Event) => void;
  ondataavailable: (evt: BlobEvent) => void;
  onpause: (evt: Event) => void;
  onresume: (evt: Event) => void;
  onerror: (evt: MediaRecorderErrorEvent) => void;

  static isTypeSupported(mimeType: string): boolean {
    return false;
  }

  constructor(stream: MediaStream,
              options?: MediaRecorderOptions) {
    throw new Error('MediaRecorder not available in this browser.');
  }


  pause(): void {
  }

  requestData(): void {
  }

  resume(): void {
  }

  start(timeslice: number): void {
  }

  stop(): void {
  }
}

@Injectable()
export class AudioRecorderService {
  private requestProvider: AudioInputProvider;
  private recorderImpl: MediaRecorderConstructor;
  private currentRecorder: MediaRecorder;
  private recordingStateChange: Subject<RecorderServiceStatus>;
  recordingStateChange$: Observable<RecorderServiceStatus>;
  private newRecording: Subject<Blob>;
  newRecording$: Observable<Blob>;
  private isRecording: boolean;
  private chunks: Blob[];
  private knownTypes = [
    {mimeType: 'audio/ogg', extension: 'ogg'},
    {mimeType: 'audio/webm', extension: 'webm'},
    {mimeType: 'audio/wav', extension: 'wav'}
  ];

  constructor(@Inject('AudioInputProvider') requestProvider: AudioInputProvider,
              @Inject(
                'MediaRecorderFactory'
              ) recorderImpl: MediaRecorderConstructor,
              private ngZone: NgZone,
              private notifier: NotificationService) {
    this.requestProvider = requestProvider;
    this.recorderImpl = recorderImpl;
    this.recordingStateChange = new Subject<RecorderServiceStatus>();
    this.recordingStateChange$ = this.recordingStateChange.asObservable();
    this.newRecording = new Subject<Blob>();
    this.newRecording$ = this.newRecording.asObservable();
    this.isRecording = false;
    this.chunks = [];
  }

  private getRecorderInstance(): Promise<MediaRecorder> {
    return this.requestProvider().then(stream => {
      const supported = this.knownTypes.find(
        ({mimeType, extension}) => this.recorderImpl.isTypeSupported(mimeType)
      );
      const recorder = new this.recorderImpl(stream, supported ? {
        mimeType: supported.mimeType
      } : {});

      recorder.ondataavailable = e => this.chunks.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, {
          'type': recorder.mimeType || supported.mimeType
        });
        this.chunks.length = 0;
        this.ngZone.run(() => {
          this.newRecording.next(
            blob
          );
        });
      };
      return recorder;
    });
  }

  toggleRecording(): void {
    if (this.isRecording) {
      this.endRecording();
    } else {
      this.getRecorderInstance()
        .then(recorder => this.startRecording(recorder))
        .catch(e => {
          this.recordingStateChange.next('disabled'); // don't really need to do this
          this.notifier.displayError(e);
        });
    }
  }

  private startRecording(recorder: MediaRecorder): void {
    this.currentRecorder = recorder;
    this.isRecording = true;
    recorder.start();
    this.recordingStateChange.next('recording');
  }

  private endRecording(): void {
    if (this.currentRecorder) {
      this.isRecording = false;
      this.currentRecorder.stop();
      for (const track of this.currentRecorder.stream.getAudioTracks()) {
        track.stop();
      }
      this.chunks.length = 0; // empty the array
      this.recordingStateChange.next('enabled');
      this.currentRecorder = null;
    }
  }
}
