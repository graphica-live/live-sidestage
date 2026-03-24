import { useId } from 'react';
import { getEditorCropRadiusRatio } from '../utils/canvas';

type CropMaskOverlayProps = {
  active?: boolean;
  intro?: boolean;
};

export default function CropMaskOverlay({ active = false, intro = false }: CropMaskOverlayProps) {
  const maskInstanceId = useId().replace(/:/g, '-');
  const overlayColor = active
    ? 'rgba(37, 244, 238, 0.24)'
    : intro
      ? 'rgba(37, 244, 238, 0.42)'
      : 'rgba(37, 244, 238, 0.32)';
  const introClassName = intro ? ' editor-crop-mask-intro' : '';
  const cropRadius = 100 * getEditorCropRadiusRatio(100);
  const maskId = `crop-mask-${maskInstanceId}`;

  return (
    <svg
      viewBox="0 0 100 100"
      className={`editor-crop-mask h-full w-full overflow-visible${introClassName}`}
      aria-hidden="true"
    >
      <defs>
        <mask id={maskId}>
          <rect width="100" height="100" fill="white" />
          <circle cx="50" cy="50" r={cropRadius} fill="black" />
        </mask>
      </defs>

      <rect width="100" height="100" fill={overlayColor} mask={`url(#${maskId})`} />
    </svg>
  );
}