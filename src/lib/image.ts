/** 画像ファイルを読み込む */
export function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => {
      URL.revokeObjectURL(url);
      rej(new Error('画像を読み込めませんでした'));
    };
    i.src = url;
  });
}

/** 元画像上の切り抜き範囲 (px) */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 画像の指定範囲を w×h に縮小して JPEG の dataURL にする */
export function cropImage(img: HTMLImageElement, rect: CropRect, w: number, h: number, quality = 0.8): string {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}
