import {AfterViewInit, Component, OnDestroy} from '@angular/core';
import {
  AudioPlayerService,
  AudioResourceError, AudioResource
} from './services/audio-player/audio-player.service';
import {
  ExtractionResult,
  FeatureExtractionService
} from './services/feature-extraction/feature-extraction.service';
import {ExtractorOutputInfo} from './feature-extraction-menu/feature-extraction-menu.component';
import {DomSanitizer} from '@angular/platform-browser';
import {MdIconRegistry} from '@angular/material';
import {Subscription} from 'rxjs/Subscription';
import {
  AnalysisItem,
  RootAudioItem,
  isLoadedRootAudioItem,
  Item,
  LoadedRootAudioItem,
  createExtractionRequest,
} from './analysis-item/AnalysisItem';
import {OnSeekHandler} from './playhead/PlayHeadHelpers';
import {
  downloadResource,
  PersistentStack,
  SerialisedAnalysisItem,
  SerialisedNotebook,
  exampleSession
} from './Session';
import {Observable} from 'rxjs/Observable';
import {RequestId} from 'piper/protocols/WebWorkerProtocol';

@Component({
  selector: 'ugly-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnDestroy, AfterViewInit {
  audioBuffer: AudioBuffer; // TODO consider revising
  canExtract: boolean;
  private onAudioDataSubscription: Subscription;
  private onProgressUpdated: Subscription;
  private analyses: PersistentStack<Item>; // TODO some immutable state container describing entire session
  private nRecordings: number; // TODO user control for naming a recording
  private countingId: number; // TODO improve uniquely identifying items
  private rootAudioItem: LoadedRootAudioItem;
  private onSeek: OnSeekHandler;

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
              return isLoadedRootAudioItem(val) &&
                val.uri === this.rootAudioItem.uri;
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
  }

  ngAfterViewInit(): void {
    const triggerLoadAudio: (resource: Blob) => Observable<LoadedRootAudioItem>
      = (resource) => Observable.create(obs => {
      obs.next(this.onFileOpened(resource));
    });

    const setupPlaceholder = (item: SerialisedAnalysisItem,
                              rootAudio: LoadedRootAudioItem): AnalysisItem => {
      const placeholder: AnalysisItem = {
        parent: rootAudio,
        hasSharedTimeline: true,
        extractorKey: item.extractorKey,
        outputId: item.outputId,
        title: item.title,
        description: item.description,
        id: `${++this.countingId}`, // take it from the item and update countindId?
        progress: 0
      };
      this.analyses.unshift(placeholder);
      return placeholder;
    };

    const hydrateSession = (session: SerialisedNotebook) => {
      const downloadAndTrigger = Observable.fromPromise(
        downloadResource(session.root.uri)
      ).mergeMap(triggerLoadAudio);
      const audioLoaded =
        (x: LoadedRootAudioItem) => this.audioService.audioLoaded$
          .filter(response => x.uri === (response as AudioResource).url)
          .map<AudioResource, LoadedRootAudioItem>(() => x);

      const sequentiallyAnalyse = (rootAudioItem: LoadedRootAudioItem) => {
        return Observable.fromPromise((async () => {
          for (const analysis of session.analyses) {
            await this.sendExtractionRequest(setupPlaceholder(
              analysis,
              rootAudioItem)
            );
          }
        })());
      };

      return downloadAndTrigger
        .mergeMap(audioLoaded)
        .mergeMap(sequentiallyAnalyse);
    };
    hydrateSession(exampleSession).subscribe(
      () => console.warn('done'),
      console.error,
      () => console.warn('complete')
    );
  }

  onFileOpened(file: File | Blob): LoadedRootAudioItem | null {
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
    } as RootAudioItem;
    this.rootAudioItem = pending as LoadedRootAudioItem; // TODO this is silly

    // TODO re-ordering of items for display
    // , one alternative is a Angular Pipe / Filter for use in the Template
    this.analyses.unshift(pending);
    return this.rootAudioItem;
  }

  extractFeatures(outputInfo: ExtractorOutputInfo): RequestId | null {
    if (!this.canExtract || !outputInfo) {
      return;
    }

    this.canExtract = false;

    const placeholderCard: AnalysisItem = {
      parent: this.rootAudioItem,
      hasSharedTimeline: true,
      extractorKey: outputInfo.extractorKey,
      outputId: outputInfo.outputId,
      title: outputInfo.name,
      description: outputInfo.outputId,
      id: `${++this.countingId}`,
      progress: 0
    };
    this.analyses.unshift(placeholderCard);
    this.sendExtractionRequest(placeholderCard);
    return placeholderCard.id;
  }

  ngOnDestroy(): void {
    this.onAudioDataSubscription.unsubscribe();
    this.onProgressUpdated.unsubscribe();
  }

  private sendExtractionRequest(analysis: AnalysisItem): Promise<void> {
    const findAndUpdateItem = (result: ExtractionResult): void => {
      // TODO subscribe to the extraction service instead
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
    };
    return this.featureService.extract(
      analysis.id,
      createExtractionRequest(analysis))
      .then(findAndUpdateItem)
      .catch(err => {
        this.canExtract = true;
        this.analyses.shift();
        console.error(`Error whilst extracting: ${err}`);
      });
  }
}
