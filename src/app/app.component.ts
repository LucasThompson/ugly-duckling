import {Component, OnDestroy, ViewChild} from '@angular/core';
import {
  AudioPlayerService,
  AudioResourceError, AudioResource
} from './services/audio-player/audio-player.service';
import {FeatureExtractionService} from './services/feature-extraction/feature-extraction.service';
import {ExtractorOutputInfo} from './feature-extraction-menu/feature-extraction-menu.component';
import {DomSanitizer} from '@angular/platform-browser';
import {MdIconRegistry} from '@angular/material';
import {Subscription} from 'rxjs/Subscription';
import {
  AnalysisItem,
  isRootAudioItem,
  Item, PendingAnalysisItem, PendingRootAudioItem, RootAudioItem
} from './analysis-item/analysis-item.component';
import {OnSeekHandler} from './playhead/PlayHeadHelpers';
import {ActionTrayComponent} from "./actions/action-tray.component";

class PersistentStack<T> {
  private stack: T[];
  private history: T[][];

  constructor() {
    this.stack = [];
    this.history = [];
  }

  shift(): T {
    this.history.push([...this.stack]);
    const item = this.stack[0];
    this.stack = this.stack.slice(1);
    return item;
  }

  unshift(item: T): number {
    this.history.push([...this.stack]);
    this.stack = [item, ...this.stack];
    return this.stack.length;
  }

  findIndex(predicate: (value: T,
                        index: number,
                        array: T[]) => boolean): number {
    return this.stack.findIndex(predicate);
  }

  filter(predicate: (value: T, index: number, array: T[]) => boolean): T[] {
    return this.stack.filter(predicate);
  }

  get(index: number): T {
    return this.stack[index];
  }

  set(index: number, value: T) {
    this.history.push([...this.stack]);
    this.stack = [
      ...this.stack.slice(0, index),
      value,
      ...this.stack.slice(index + 1)
    ];
  }

  toIterable(): Iterable<T> {
    return this.stack;
  }
}

@Component({
  selector: 'ugly-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnDestroy {
  @ViewChild(ActionTrayComponent) tray: ActionTrayComponent;
  audioBuffer: AudioBuffer; // TODO consider revising
  canExtract: boolean;
  private onAudioDataSubscription: Subscription;
  private onProgressUpdated: Subscription;
  private analyses: PersistentStack<Item>; // TODO some immutable state container describing entire session
  private nRecordings: number; // TODO user control for naming a recording
  private countingId: number; // TODO improve uniquely identifying items
  private rootAudioItem: RootAudioItem;
  private onSeek: OnSeekHandler;
  private closeTray: () => void;

  constructor(private audioService: AudioPlayerService,
              private featureService: FeatureExtractionService,
              private iconRegistry: MdIconRegistry,
              private sanitizer: DomSanitizer) {
    this.analyses = new PersistentStack<AnalysisItem>();
    this.canExtract = false;
    this.nRecordings = 0;
    this.countingId = 0;
    this.onSeek = (time) => this.audioService.seekTo(time);
    this.rootAudioItem = {} as any; // TODO eugh

    iconRegistry.addSvgIcon(
      'duck',
      sanitizer.bypassSecurityTrustResourceUrl('assets/duck.svg')
    );

    this.onAudioDataSubscription = this.audioService.audioLoaded$.subscribe(
      resource => {
        const wasError = (resource as AudioResourceError).message != null;
        if (wasError) {
          this.analyses.shift();
          this.canExtract = false;
        } else {
          this.audioBuffer = (resource as AudioResource).samples;
          this.rootAudioItem.audioData = this.audioBuffer;
          if (this.audioBuffer) {
            this.canExtract = true;
            const currentRootIndex = this.analyses.findIndex(val => {
              return isRootAudioItem(val) && val.uri === this.rootAudioItem.uri;
            });
            if (currentRootIndex !== -1) {
              this.analyses.set(
                currentRootIndex,
                Object.assign(
                  {},
                  this.analyses.get(currentRootIndex),
                  {audioData: this.audioBuffer}
                )
              );
            }
          }
        }
      }
    );
    this.onProgressUpdated = this.featureService.progressUpdated$.subscribe(
      progress => {
        const index = this.analyses.findIndex(val => val.id === progress.id);
        if (index === -1) {
          return;
        }

        this.analyses.set(
          index,
          Object.assign(
            {},
            this.analyses.get(index),
            {progress: progress.value}
          )
        );
      }
    );
    this.closeTray = () => {
      this.tray.toggle();
    };
  }

  onFileOpened(file: File | Blob) {
    this.canExtract = false;
    const url = this.audioService.loadAudio(file);
    // TODO is it safe to assume it is a recording?
    const title = (file instanceof File) ?
      (file as File).name : `Recording ${this.nRecordings++}`;

    if (this.analyses.filter(item => item.title === title).length > 0) {
      // TODO this reveals how brittle the current name / uri based id is
      // need something more robust, and also need to notify the user
      // in a suitable way in the actual event of a duplicate file
      console.warn('There is already a notebook based on this audio file.');
      return;
    }

    const pending = {
      uri: url,
      hasSharedTimeline: true,
      title: title,
      description: new Date().toLocaleString(),
      id: `${++this.countingId}`
    } as PendingRootAudioItem;
    this.rootAudioItem = pending as RootAudioItem; // TODO this is silly

    // TODO re-ordering of items for display
    // , one alternative is a Angular Pipe / Filter for use in the Template
    this.analyses.unshift(pending);
  }

  extractFeatures(outputInfo: ExtractorOutputInfo): void {
    if (!this.canExtract || !outputInfo) {
      return;
    }

    this.canExtract = false;

    const placeholderCard: PendingAnalysisItem = {
      parent: this.rootAudioItem,
      hasSharedTimeline: true,
      extractorKey: outputInfo.combinedKey,
      title: outputInfo.name,
      description: outputInfo.outputId,
      id: `${++this.countingId}`,
      progress: 0
    };
    this.analyses.unshift(placeholderCard);

    this.featureService.extract(`${this.countingId}`, {
      audioData: [...Array(this.audioBuffer.numberOfChannels).keys()]
        .map(i => this.audioBuffer.getChannelData(i)),
      audioFormat: {
        sampleRate: this.audioBuffer.sampleRate,
        channelCount: this.audioBuffer.numberOfChannels,
        length: this.audioBuffer.length
      },
      key: outputInfo.extractorKey,
      outputId: outputInfo.outputId
    }).then(result => { // TODO subscribe to the extraction service instead
      const i = this.analyses.findIndex(val => val.id === result.id);
      this.canExtract = true;
      if (i !== -1) {
        this.analyses.set(
          i,
          Object.assign(
            {},
            this.analyses.get(i),
            result.result,
            result.unit ? {unit: result.unit} : {}
          )
        );
      }  // TODO else remove the item?
    }).catch(err => {
      this.canExtract = true;
      this.analyses.shift();
      console.error(`Error whilst extracting: ${err}`);
    });
  }

  ngOnDestroy(): void {
    this.onAudioDataSubscription.unsubscribe();
    this.onProgressUpdated.unsubscribe();
  }
}
