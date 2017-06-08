/**
 * Created by lucast on 21/03/2017.
 */
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnDestroy,
  OnInit
} from '@angular/core';
import {naivePagingMapper} from '../visualisations/WavesJunk';
import {OnSeekHandler} from '../playhead/PlayHeadHelpers';
import {
  defaultColourGenerator,
  HigherLevelFeatureShape
} from '../visualisations/FeatureUtilities';
import {
  RenderLoopService,
  TaskRemover
} from '../services/render-loop/render-loop.service';
import {
  Item,
  AnalysisItem,
  isAnalysisItem,
  isRootAudioItem,
  isPendingAnalysisItem,
  isPendingRootAudioItem
} from './AnalysisItem';

@Component({
  selector: 'ugly-analysis-item',
  templateUrl: './analysis-item.component.html',
  styleUrls: ['./analysis-item.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AnalysisItemComponent implements OnInit, OnDestroy {

  // TODO should be TimelineTimeContext?
  @Input() set timeline(timeline: Timeline) {
    this.mTimeline = timeline;
    this.resetRemoveAnimation();
  }

  get timeline(): Timeline {
    return this.mTimeline;
  }

  @Input() set isActive(isActive: boolean) {
    this.removeAnimation();
    this.mIsActive = isActive;
    if (isActive) {
      this.resetRemoveAnimation();
    }
  }

  get isActive() {
    return this.mIsActive;
  }

  @Input() item: Item;
  @Input() contentWidth: number;
  @Input() onSeek: OnSeekHandler;
  // TODO move / re-think - naivePagingMapper feels like a big ol' bodge
  private removeAnimation: TaskRemover;
  private hasProgressOnInit = false;
  private mIsActive: boolean;
  private mTimeline: Timeline;

  constructor(private renderLoop: RenderLoopService) {}

  ngOnInit(): void {
    this.resetRemoveAnimation();
    this.hasProgressOnInit = this.item.progress != null;
  }

  isLoading(): boolean {
    return this.hasProgressOnInit && this.item.progress < 100;
  }

  isAudioItem(): boolean {
    return this.item && isRootAudioItem(this.item);
  }

  isPending(): boolean {
    return this.item &&
      !isRootAudioItem(this.item) && !isAnalysisItem(this.item) &&
      (isPendingAnalysisItem(this.item) || isPendingRootAudioItem(this.item));
  }

  getFeatureShape(): HigherLevelFeatureShape | null {
    return !isPendingRootAudioItem(this.item) &&
    isAnalysisItem(this.item) ? this.item.shape : null;
  }

  getDuration(): number | null {
    if (isRootAudioItem(this.item)) {
      return this.item.audioData.duration;
    }
    if (isAnalysisItem(this.item)) {
      return this.item.parent.audioData.duration;
    }
  }

  getNextColour(): string {
    return defaultColourGenerator.next().value;
  }

  ngOnDestroy(): void {
    this.removeAnimation();
  }

  private resetRemoveAnimation(): void {
    if (this.removeAnimation) {
      this.removeAnimation();
    }
    const createPagingTask = () => {
      const pagingMapper = naivePagingMapper(this.timeline);
      return this.renderLoop.addPlayingTask(currentTime => {
        pagingMapper(currentTime);
      });
    };
    // only add a pager to audio items, it can drive the feature items
    // or, if the item has an independent timeline, it will need to drive itself
    // or, if an analysis item's parent has an independent timeline, ^^
    // this is messy, probably non exhaustive, and not efficient
    // for example, two analysis items with a parent who for some meaningless
    // reason does not have a shared timeline, could share a timeline with
    // each other... which implies the paging mapper should be provided
    // from above, because that is where those details are known
    const remover = this.timeline && this.item &&
    (
      this.isAudioItem() ||
      !this.item.hasSharedTimeline ||
      (
        isAnalysisItem(this.item) &&
        !(this.item as AnalysisItem).parent.hasSharedTimeline
      )
    ) ? createPagingTask() : () => {};
    this.removeAnimation = () => {
      remover();
      this.removeAnimation = () => {};
    };
  }
}
