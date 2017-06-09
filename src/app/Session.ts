/**
 * Created by lucast on 08/06/2017.
 */
import {
  Item,
  RootAudioItem
} from './analysis-item/AnalysisItem';

export interface SerialisedAnalysisItem extends Item {
  parent: RootAudioItem;
  extractorKey: string;
  outputId: string;
}

interface SerialisedNotebook {
  root: RootAudioItem;
  analyses: SerialisedAnalysisItem[];
}

export type ResourceRetriever = (url: string) => Promise<Blob>;

export const downloadResource: ResourceRetriever = async (url) => {
  const response = await fetch(url);
  const mimeType = response.headers.get('content-type');
  // Safari's fetch.blob implementation doesn't populate the type property
  // causing the audio player to fail due to an unsupported type.
  // Manually create a blob from an array buffer and the content type in
  // the response object
  const arrayBufferToBlob = async () => {
    const arrayBuffer = await response.arrayBuffer();
    return new Blob([arrayBuffer], {type: mimeType});
  };
  return mimeType ? arrayBufferToBlob() : response.blob();
};

export class PersistentStack<T> {
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
