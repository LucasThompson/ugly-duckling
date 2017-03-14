import {
  Component, OnInit, ViewChild, ElementRef, Input, AfterViewInit, NgZone,
  OnDestroy
} from '@angular/core';
import {AudioPlayerService} from "../services/audio-player/audio-player.service";
import wavesUI from 'waves-ui';
import {
  FeatureExtractionService
} from "../services/feature-extraction/feature-extraction.service";
import {Subscription} from "rxjs";
import {
  FeatureCollection,
  FixedSpacedFeatures, SimpleResponse
} from "piper/HigherLevelUtilities";
import {toSeconds} from "piper";
import {FeatureList, Feature} from "piper/Feature";
import * as Hammer from 'hammerjs';

type Timeline = any; // TODO what type actually is it.. start a .d.ts for waves-ui?
type Layer = any;
type Track = any;
type DisposableIndex = number;
type Colour = string;

@Component({
  selector: 'app-waveform',
  templateUrl: './waveform.component.html',
  styleUrls: ['./waveform.component.css']
})
export class WaveformComponent implements OnInit, AfterViewInit, OnDestroy {

  @ViewChild('track') trackDiv: ElementRef;

  private _audioBuffer: AudioBuffer;
  private timeline: Timeline;
  private cursorLayer: any;
  private disposableLayers: Layer[];
  private colouredLayers: Map<DisposableIndex, Colour>;

  @Input()
  set audioBuffer(buffer: AudioBuffer) {
    this._audioBuffer = buffer || undefined;
    if (this.audioBuffer) {
      this.renderWaveform(this.audioBuffer);
      this.renderSpectrogram(this.audioBuffer);
    }
  }

  get audioBuffer(): AudioBuffer {
    return this._audioBuffer;
  }

  private featureExtractionSubscription: Subscription;
  private playingStateSubscription: Subscription;
  private seekedSubscription: Subscription;
  private isPlaying: boolean;
  private offsetAtPanStart: number;
  private initialZoom: number;
  private initialDistance: number;

  constructor(private audioService: AudioPlayerService,
              private piperService: FeatureExtractionService,
              public ngZone: NgZone) {
    this.colouredLayers = new Map();
    this.disposableLayers = [];
    this._audioBuffer = undefined;
    this.timeline = undefined;
    this.cursorLayer = undefined;
    this.isPlaying = false;
    const colours = function* () {
      const circularColours = [
        'black',
        'red',
        'green',
        'purple',
        'orange'
      ];
      let index = 0;
      const nColours = circularColours.length;
      while (true) {
        yield circularColours[index = ++index % nColours];
      }
    }();

    this.featureExtractionSubscription = piperService.featuresExtracted$.subscribe(
      features => {
        this.renderFeatures(features, colours.next().value);
      });
    this.playingStateSubscription = audioService.playingStateChange$.subscribe(
      isPlaying => {
        this.isPlaying = isPlaying;
        if (this.isPlaying)
          this.animate();
      });
    this.seekedSubscription = audioService.seeked$.subscribe(() => {
      if (!this.isPlaying)
        this.animate();
    });
  }

  ngOnInit() {
  }

  ngAfterViewInit(): void {
    this.timeline = this.renderTimeline();
  }

  renderTimeline(duration: number = 1.0): Timeline {
    const track: HTMLElement = this.trackDiv.nativeElement;
    track.innerHTML = "";
    const height: number = track.getBoundingClientRect().height;
    const width: number = track.getBoundingClientRect().width;
    const pixelsPerSecond = width / duration;
    const timeline = new wavesUI.core.Timeline(pixelsPerSecond, width);
    timeline.createTrack(track, height/2, 'wave');
    timeline.createTrack(track, height/2, 'grid');
    return timeline;
  }

  estimatePercentile(matrix, percentile) {
    // our sample is not evenly distributed across the whole data set:
    // it is guaranteed to include at least one sample from every
    // column, and could sample some values more than once. But it
    // should be good enough in most cases (todo: show this)
    if (matrix.length === 0) {
      return 0.0;
    }
    const w = matrix.length;
    const h = matrix[0].length;
    const n = w * h;
    const m = (n > 50000 ? 50000 : n); // should base that on the %ile
    let m_per = Math.floor(m / w);
    if (m_per < 1) m_per = 1;
    let sample = [];
    for (let x = 0; x < w; ++x) {
      for (let i = 0; i < m_per; ++i) {
        const y = Math.floor(Math.random() * h);
        const value = matrix[x][y];
        if (!isNaN(value) && value !== Infinity) {
          sample.push(value);
        }
      }
    }
    if (sample.length === 0) {
      console.log("WARNING: No samples gathered, even though we hoped for " +
                  (m_per * w) + " of them");
      return 0.0;
    }
    sample.sort((a,b) => { return a - b; });
    const ix = Math.floor((sample.length * percentile) / 100);
    console.log("Estimating " + percentile + "-%ile of " +
                n + "-sample dataset (" + w + " x " + h + ") as value " + ix +
                " of sorted " + sample.length + "-sample subset");
    const estimate = sample[ix];
    console.log("Estimate is: " + estimate + " (where min sampled value = " +
                sample[0] + " and max = " + sample[sample.length-1] + ")");
    return estimate;
  }

  interpolatingMapper(hexColours) {
    const colours = hexColours.map(n => {
      const i = parseInt(n, 16);
      return [ (i >> 16) & 255, (i >> 8) & 255, i & 255, 255 ];
    });
    const last = colours.length - 1;
    return (value => {
      // value must be in the range [0,1]. We quantize to 256 levels,
      // as the PNG encoder deep inside uses a limited palette for
      // simplicity. Should document this for the mapper. Also that
      // individual colour values should be integers
      value = Math.round(value * 255) / 255;
      const m = value * last;
      if (m >= last) {
        return colours[last];
      }
      if (m <= 0) {
        return colours[0];
      }
      const base = Math.floor(m);
      const prop0 = base + 1.0 - m;
      const prop1 = m - base;
      const c0 = colours[base];
      const c1 = colours[base+1];
      return [ Math.round(c0[0] * prop0 + c1[0] * prop1),
               Math.round(c0[1] * prop0 + c1[1] * prop1),
               Math.round(c0[2] * prop0 + c1[2] * prop1),
               255 ];
    });
  }

  iceMapper() {
    let hexColours = [
      // Based on ColorBrewer ylGnBu
      "ffffff", "ffff00", "f7fcf0", "e0f3db", "ccebc5", "a8ddb5",
      "7bccc4", "4eb3d3", "2b8cbe", "0868ac", "084081", "042040"
    ];
    hexColours.reverse();
    return this.interpolatingMapper(hexColours);
  }

  renderWaveform(buffer: AudioBuffer): void {
    const height: number = this.trackDiv.nativeElement.getBoundingClientRect().height / 2;
    const waveTrack = this.timeline.getTrackById('wave');
    if (this.timeline) {
      // resize
      const width = this.trackDiv.nativeElement.getBoundingClientRect().width;

      // loop through layers and remove them, waves-ui provides methods for this but it seems to not work properly
      const timeContextChildren = this.timeline.timeContext._children;

      for (let i = 0, length = this.disposableLayers.length; i < length; ++i) {
        let layer = this.disposableLayers.pop();
//        if (waveTrack.hasElement(layer)) {
//          waveTrack.remove(layer);
//        }

        const index = timeContextChildren.indexOf(layer.timeContext);
        if (index >= 0) {
          timeContextChildren.splice(index, 1);
        }
        layer.destroy();
      }
      this.colouredLayers.clear();

      this.timeline.visibleWidth = width;
      this.timeline.pixelsPerSecond = width / buffer.duration;
      waveTrack.height = height;
    } else {
      this.timeline = this.renderTimeline(buffer.duration)
    }
    this.timeline.timeContext.offset = 0.5 * this.timeline.timeContext.visibleDuration;

    // time axis
    const timeAxis = new wavesUI.helpers.TimeAxisLayer({
      height: height,
      color: '#b0b0b0'
    });
    this.addLayer(timeAxis, waveTrack, this.timeline.timeContext, true);

    const waveformLayer = new wavesUI.helpers.WaveformLayer(buffer, {
      top: 10,
      height: height * 0.9,
      color: 'darkblue'
    });
    this.addLayer(waveformLayer, waveTrack, this.timeline.timeContext);

    this.cursorLayer = new wavesUI.helpers.CursorLayer({
      height: height
    });
    this.addLayer(this.cursorLayer, waveTrack, this.timeline.timeContext);
    this.timeline.state = new wavesUI.states.CenteredZoomState(this.timeline);
    waveTrack.render();
    waveTrack.update();


    if ('ontouchstart' in window) {
      interface Point {
        x: number;
        y: number;
      }

      let zoomGestureJustEnded: boolean = false;

      const pixelToExponent: Function = wavesUI.utils.scales.linear()
        .domain([0, 100]) // 100px => factor 2
        .range([0, 1]);

      const calculateDistance: (p1: Point, p2: Point) => number = (p1, p2) => {
        return Math.pow(
          Math.pow(p2.x - p1.x, 2) +
          Math.pow(p2.y - p1.y, 2), 0.5);
      };

      const hammertime = new Hammer(this.trackDiv.nativeElement);
      const scroll = (ev) => {
        if (zoomGestureJustEnded) {
          zoomGestureJustEnded = false;
          console.log("Skip this event: likely a single touch dangling from pinch");
          return;
        }
        this.timeline.timeContext.offset = this.offsetAtPanStart +
          this.timeline.timeContext.timeToPixel.invert(ev.deltaX);
        this.timeline.tracks.update();
      };

      const zoom = (ev) => {
        const minZoom = this.timeline.state.minZoom;
        const maxZoom = this.timeline.state.maxZoom;
        const distance = calculateDistance({
          x: ev.pointers[0].clientX,
          y: ev.pointers[0].clientY
        }, {
          x: ev.pointers[1].clientX,
          y: ev.pointers[1].clientY
        });

        const lastCenterTime =
          this.timeline.timeContext.timeToPixel.invert(ev.center.x);

        const exponent = pixelToExponent(distance - this.initialDistance);
        const targetZoom = this.initialZoom * Math.pow(2, exponent);

        this.timeline.timeContext.zoom =
          Math.min(Math.max(targetZoom, minZoom), maxZoom);

        const newCenterTime =
          this.timeline.timeContext.timeToPixel.invert(ev.center.x);

        this.timeline.timeContext.offset += newCenterTime - lastCenterTime;
        this.timeline.tracks.update();
      };
      const seek = (ev) => {
        this.audioService.seekTo(
          this.timeline.timeContext.timeToPixel.invert(ev.center.x) - this.timeline.timeContext.offset
        );
      };
      hammertime.get('pinch').set({ enable: true });
      hammertime.on('panstart', () => {
        this.offsetAtPanStart = this.timeline.timeContext.offset;
      });
      hammertime.on('panleft', scroll);
      hammertime.on('panright', scroll);
      hammertime.on('pinchstart', (e) => {
        this.initialZoom = this.timeline.timeContext.zoom;

        this.initialDistance = calculateDistance({
          x: e.pointers[0].clientX,
          y: e.pointers[0].clientY
        }, {
          x: e.pointers[1].clientX,
          y: e.pointers[1].clientY
        });
      });
      hammertime.on('pinch', zoom);
      hammertime.on('pinchend', () => {
        zoomGestureJustEnded = true;
      });
      hammertime.on('tap', seek);
    }

    this.animate();
  }

  renderSpectrogram(buffer: AudioBuffer): void {
    const height: number = this.trackDiv.nativeElement.getBoundingClientRect().height / 2;
    const gridTrack = this.timeline.getTrackById('grid');

    const spectrogramLayer = new wavesUI.helpers.SpectrogramLayer(buffer, {
      top: 10,
      height: height * 0.9,
      stepSize: 512,
      fftSize: 1024
    });
    this.addLayer(spectrogramLayer, gridTrack, this.timeline.timeContext);

    this.timeline.tracks.update();
  }

  // TODO refactor - this doesn't belong here
  private renderFeatures(extracted: SimpleResponse, colour: Colour): void {
    if (!extracted.hasOwnProperty('features') || !extracted.hasOwnProperty('outputDescriptor')) return;
    if (!extracted.features.hasOwnProperty('shape') || !extracted.features.hasOwnProperty('data')) return;
    const features: FeatureCollection = (extracted.features as FeatureCollection);
    const outputDescriptor = extracted.outputDescriptor;
    const height = this.trackDiv.nativeElement.getBoundingClientRect().height;
    const waveTrack = this.timeline.getTrackById('main');

    // TODO refactor all of this
    switch (features.shape) {
      case 'vector': {
        const stepDuration = (features as FixedSpacedFeatures).stepDuration;
        const featureData = (features.data as Float32Array);
        if (featureData.length === 0) return;
        const normalisationFactor = 1.0 /
          featureData.reduce(
            (currentMax, feature) => Math.max(currentMax, feature),
            -Infinity
          );

        const plotData = [...featureData].map((feature, i) => {
          return {
            cx: i * stepDuration,
            cy: feature * normalisationFactor
          };
        });

        let lineLayer = new wavesUI.helpers.LineLayer(plotData, {
          color: colour,
          height: height
        });
        this.colouredLayers.set(this.addLayer(
          lineLayer,
          waveTrack,
          this.timeline.timeContext
        ), colour);
        break;
      }
      case 'list': {
        const featureData = (features.data as FeatureList);
        if (featureData.length === 0) return;
        // TODO look at output descriptor instead of directly inspecting features
        const hasDuration = outputDescriptor.configured.hasDuration;
        const isMarker = !hasDuration
          && outputDescriptor.configured.binCount === 0
          && featureData[0].featureValues == null;
        const isRegion = hasDuration
          && featureData[0].timestamp != null;
        // TODO refactor, this is incomprehensible
        if (isMarker) {
          const plotData = featureData.map(feature => {
            return {x: toSeconds(feature.timestamp)}
          });
          let markerLayer = new wavesUI.helpers.MarkerLayer(plotData, {
            height: height,
            color: colour,
          });
          this.colouredLayers.set(this.addLayer(
            markerLayer,
            waveTrack,
            this.timeline.timeContext
          ), colour);
        } else if (isRegion) {
          const binCount = outputDescriptor.configured.binCount || 0;
          const isBarRegion = featureData[0].featureValues.length >= 1 || binCount >= 1 ;
          const getSegmentArgs = () => {
            if (isBarRegion) {

              // TODO refactor - this is messy
              interface FoldsToNumber<T> {
                reduce(fn: (previousValue: number,
                            currentValue: T,
                            currentIndex: number,
                            array: ArrayLike<T>) => number,
                       initialValue?: number): number;
              }

              // TODO potentially change impl., i.e avoid reduce
              const findMin = <T>(arr: FoldsToNumber<T>, getElement: (x: T) => number): number => {
                return arr.reduce((min, val) => Math.min(min, getElement(val)), Infinity);
              };

              const findMax = <T>(arr: FoldsToNumber<T>, getElement: (x: T) => number): number => {
                return arr.reduce((min, val) => Math.max(min, getElement(val)), -Infinity);
              };

              const min = findMin<Feature>(featureData, (x: Feature) => {
                return findMin<number>(x.featureValues, y => y);
              });

              const max = findMax<Feature>(featureData, (x: Feature) => {
                return findMax<number>(x.featureValues, y => y);
              });

              const barHeight = 1.0 / height;
              return [
                featureData.reduce((bars, feature) => {
                  const staticProperties = {
                    x: toSeconds(feature.timestamp),
                    width: toSeconds(feature.duration),
                    height: min + barHeight,
                    color: colour,
                    opacity: 0.8
                  };
                  // TODO avoid copying Float32Array to an array - map is problematic here
                  return bars.concat([...feature.featureValues]
                    .map(val => Object.assign({}, staticProperties, {y: val})))
                }, []),
                {yDomain: [min, max + barHeight], height: height} as any
              ];
            } else {
              return [featureData.map(feature => {
                return {
                  x: toSeconds(feature.timestamp),
                  width: toSeconds(feature.duration),
                  color: colour,
                  opacity: 0.8
                }
              }), {height: height}];
            }
          };

          let segmentLayer = new wavesUI.helpers.SegmentLayer(
            ...getSegmentArgs()
          );
          this.colouredLayers.set(this.addLayer(
            segmentLayer,
            waveTrack,
            this.timeline.timeContext
          ), colour);
        }
        break;
      }
      case 'matrix': {
        const stepDuration = (features as FixedSpacedFeatures).stepDuration;
        const matrixData = (features.data as Float32Array[]);
        if (matrixData.length === 0) return;
        console.log("matrix data length = " + matrixData.length);
        console.log("height of first column = " + matrixData[0].length);
        const targetValue = this.estimatePercentile(matrixData, 95);
        const gain = (targetValue > 0.0 ? (1.0 / targetValue) : 1.0);
        console.log("setting gain to " + gain);
        const matrixEntity = new wavesUI.utils.PrefilledMatrixEntity(matrixData);
        let matrixLayer = new wavesUI.helpers.MatrixLayer(matrixEntity, {
          gain,
          height: height * 0.8,
          top: height * 0.1,
          normalise: 'none',
          mapper: this.iceMapper()
        });
        this.colouredLayers.set(this.addLayer(
          matrixLayer,
          waveTrack,
          this.timeline.timeContext
        ), colour);
        break;
      }
      default:
        console.log("Cannot render an appropriate layer for feature shape '" +
                    features.shape + "'");
    }

    this.timeline.tracks.update();
  }

  private animate(): void {
    this.ngZone.runOutsideAngular(() => {
      // listen for time passing...
      const updateSeekingCursor = () => {
        const currentTime = this.audioService.getCurrentTime();
        this.cursorLayer.currentPosition = currentTime;
        this.cursorLayer.update();

        const currentOffset = this.timeline.timeContext.offset;
        const offsetTimestamp = currentOffset
          + currentTime;

        const visibleDuration = this.timeline.timeContext.visibleDuration;
        // TODO reduce duplication between directions and make more declarative
        // this kinda logic should also be tested
        const mustPageForward = offsetTimestamp > visibleDuration;
        const mustPageBackward = currentTime < -currentOffset;

        if (mustPageForward) {
          const hasSkippedMultiplePages = offsetTimestamp - visibleDuration > visibleDuration;

            this.timeline.timeContext.offset = hasSkippedMultiplePages ?
                -currentTime +  0.5 * visibleDuration :
                currentOffset - visibleDuration;
          this.timeline.tracks.update();
        }

        if (mustPageBackward) {
          const hasSkippedMultiplePages = currentTime + visibleDuration < -currentOffset;
            this.timeline.timeContext.offset = hasSkippedMultiplePages ?
                -currentTime + 0.5 * visibleDuration :
                currentOffset + visibleDuration;
          this.timeline.tracks.update();
        }

        if (this.isPlaying)
          requestAnimationFrame(updateSeekingCursor);
      };
      updateSeekingCursor();
    });
  }

  private addLayer(layer: Layer, track: Track, timeContext: any, isAxis: boolean = false): DisposableIndex {
    timeContext.zoom = 1.0;
    if (!layer.timeContext) {
      layer.setTimeContext(isAxis ?
        timeContext : new wavesUI.core.LayerTimeContext(timeContext));
    }
    track.add(layer);
    layer.render();
    layer.update();
    if (this.cursorLayer) {
      track.$layout.appendChild(this.cursorLayer.$el);
    }
    return this.disposableLayers.push(layer) - 1;
  }

  private static changeColour(layer: Layer, colour: string): void {
    const butcherShapes = (shape) => {
      shape.install({color: () => colour});
      shape.params.color = colour;
      shape.update(layer._renderingContext, layer.data);
    };

    layer._$itemCommonShapeMap.forEach(butcherShapes);
    layer._$itemShapeMap.forEach(butcherShapes);
    layer.render();
    layer.update();
  }

  ngOnDestroy(): void {
    this.featureExtractionSubscription.unsubscribe();
    this.playingStateSubscription.unsubscribe();
    this.seekedSubscription.unsubscribe();
  }
}
