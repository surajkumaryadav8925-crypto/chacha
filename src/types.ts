export interface Photo {
  id: string;
  key: string;
  source: string;
  thumb: string;
  original: string;
  width: number;
  height: number;
  thumbWidth: number;
  thumbHeight: number;
  aspect: number;
}

export interface PhotoDataset {
  source: string;
  count: number;
  photos: Photo[];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
