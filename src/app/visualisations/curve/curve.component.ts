/**
 * Created by lucas on 30/05/2017.
 */
import {WavesComponent} from "../waves-base.component";
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  ViewChild
} from "@angular/core";
import {VectorFeature} from "piper/HigherLevelUtilities";
import Waves from 'waves-ui-piper';
import {generatePlotData, PlotLayerData} from "../FeatureUtilities";

@Component({
  selector: 'ugly-curve',
  templateUrl: '../waves-template.html',
  styleUrls: ['../waves-template.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CurveComponent extends WavesComponent implements AfterViewInit {

  @ViewChild('track') trackDiv: ElementRef;

  private mFeature: VectorFeature;
  private currentState: PlotLayerData[];
  private height: number; // As it stands, height is fixed. Store once onInit.

  @Input() set feature(input: VectorFeature) {
    this.mFeature = input;
    this.currentState = generatePlotData([input]);
    this.update();
  }
  @Input() colour: string;

  get feature(): VectorFeature {
    return this.mFeature;
  }

  ngAfterViewInit(): void {
    this.height = this.trackDiv.nativeElement.getBoundingClientRect().height;
    this.renderTimeline(this.trackDiv);
    this.update();
  }

  update(): void {
    if (this.waveTrack) {
      this.clearTimeline(this.trackDiv);
      for (const feature of this.currentState) {
        const lineLayer = new Waves.helpers.LineLayer(feature.data, {
          color: this.colour,
          height: this.height,
          yDomain: feature.yDomain
        });
        this.addLayer(
          lineLayer,
          this.waveTrack,
          this.timeline.timeContext
        );

        // Set start and duration so that the highlight layer can use
        // them to determine which line to draw values from
        lineLayer.start = feature.startTime;
        lineLayer.duration = feature.duration;
      }
    }
  }
}
