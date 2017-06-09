/**
 * Created by lucast on 08/06/2017.
 */
import {KnownShapedFeature} from '../visualisations/FeatureUtilities';
export abstract class Item {
  id: string;
  hasSharedTimeline: boolean;
  title?: string;
  description?: string;
  progress?: number;
}

export interface RootAudioItem extends Item {
  uri: string;
}
export interface LoadedRootAudioItem extends RootAudioItem {
  audioData: AudioBuffer;
}

export interface AnalysisItem extends Item {
  parent: LoadedRootAudioItem;
  extractorKey: string;
  outputId: string;
}

export type ExtractedAnalysisItem = AnalysisItem & KnownShapedFeature & {
  unit?: string
};

export function isItem(item: Item): item is Item {
  return item.id != null && item.hasSharedTimeline != null;
}

export function isPendingRootAudioItem(item: Item): item is RootAudioItem {
  return isItem(item) && typeof (item as RootAudioItem).uri === 'string';
}

export function isLoadedRootAudioItem(item: Item): item is LoadedRootAudioItem {
  return item && isPendingRootAudioItem(item) &&
    (item as LoadedRootAudioItem).audioData instanceof AudioBuffer;
}

export function isPendingAnalysisItem(item: Item): item is AnalysisItem {
  const downcast = (item as ExtractedAnalysisItem);
  return isLoadedRootAudioItem(downcast.parent)
    && typeof downcast.extractorKey === 'string';
}

export function isExtractedAnalysisItem(it: Item): it is ExtractedAnalysisItem {
  const downcast = (it as ExtractedAnalysisItem);
  return isPendingAnalysisItem(it) &&
    downcast.shape != null &&
    downcast.collected != null;
}

// these should probably be actual concrete types with their own getUri methods
export function getRootUri(item: Item): string {
  if (isPendingRootAudioItem(item)) {
    return item.uri;
  }
  if (isPendingAnalysisItem(item)) {
    return item.parent.uri;
  }
  throw new Error('Invalid item: No URI property set.');
}
