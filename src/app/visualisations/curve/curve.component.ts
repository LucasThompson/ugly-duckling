/**
 * Created by lucas on 30/05/2017.
 */
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  ViewChild
} from '@angular/core';
import {OnSeekHandler} from '../../playhead/PlayHeadHelpers';
import {VectorFeature} from 'piper-js/one-shot';
import {
  PlayheadManager,
  PlayheadRenderer,
  VerticallyLabelled,
  VerticalScaleRenderer,
  VerticalValueInspectorRenderer,
  WavesComponent
} from '../waves-base.component';
import {TracksComponent} from '../tracks/tracks.components';

@Component({
  selector: 'ugly-curve',
  template: `
    <ugly-tracks
      [timeline]="timeline"
      [width]="width"
      [onSeek]="onSeek"
      [colour]="colour"
      [tracks]="[curve]"
      [duration]="duration"
    ></ugly-tracks>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {provide: VerticallyLabelled, useExisting: CurveComponent },
    {provide: VerticalScaleRenderer, useExisting: CurveComponent},
    {provide: VerticalValueInspectorRenderer, useExisting: CurveComponent},
    {provide: PlayheadRenderer, useExisting: CurveComponent },
    {provide: WavesComponent, useExisting: CurveComponent}
  ]
})
export class CurveComponent
  implements VerticalValueInspectorRenderer, PlayheadRenderer {

  @Input() timeline: Timeline; // TODO refactor WaveComponents to have own Timeline, sharing a TimeContext
  @Input() onSeek: OnSeekHandler;
  @Input() width: number;
  @Input() curve: VectorFeature;
  @Input() colour: string;
  @Input() duration: number;
  @ViewChild(TracksComponent) tracksComponent: TracksComponent;

  renderPlayhead(initialTime: number, colour: string): PlayheadManager {
    return this.tracksComponent.renderPlayhead(initialTime, colour);
  }

  renderInspector(range: [number, number], unit?: string): void {
    this.tracksComponent.renderInspector(range, unit);
  }

  get updatePosition(): OnSeekHandler {
    return this.tracksComponent.updatePosition;
  }

  renderScale(range: [number, number]): void {
    this.tracksComponent.renderScale(range);
  }

  get labels(): [number, number] {
    return this.tracksComponent.labels;
  }
}
