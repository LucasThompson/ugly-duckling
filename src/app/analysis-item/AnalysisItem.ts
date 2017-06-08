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

export interface PendingRootAudioItem extends Item {
  uri: string;
}
export interface RootAudioItem extends PendingRootAudioItem {
  audioData: AudioBuffer;
}

export interface PendingAnalysisItem extends Item {
  parent: RootAudioItem;
  extractorKey: string;
}

export type AnalysisItem = PendingAnalysisItem & KnownShapedFeature & {
  unit?: string
};

export function isItem(item: Item): item is Item {
  return item.id != null && item.hasSharedTimeline != null;
}

export function isPendingRootAudioItem(item: Item): item is PendingRootAudioItem {
  return isItem(item) && typeof (item as RootAudioItem).uri === 'string';
}

export function isRootAudioItem(item: Item): item is RootAudioItem {
  return item && isPendingRootAudioItem(item) &&
    (item as RootAudioItem).audioData instanceof AudioBuffer;
}

export function isPendingAnalysisItem(item: Item): item is AnalysisItem {
  const downcast = (item as AnalysisItem);
  return isRootAudioItem(downcast.parent)
    && typeof downcast.extractorKey === 'string';
}

export function isAnalysisItem(item: Item): item is AnalysisItem {
  const downcast = (item as AnalysisItem);
  return isPendingAnalysisItem(item) &&
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
