import { useId } from 'react';
import { getEditorCropRadiusRatio } from '../utils/canvas';

type CropMaskOverlayProps = {
  active?: boolean;
  intro?: boolean;
};

export default function CropMaskOverlay({
  active = false,
  intro = false,
}: CropMaskOverlayProps) {
  const maskInstanceId = useId().replace(/:/g, '-');
  const overlayBleed = 1;
  const overlayColor = active
    ? 'rgba(37, 244, 238, 0.28)'
    : intro
      ? 'rgba(37, 244, 238, 1)'
      : 'rgba(37, 244, 238, 1)';
  const introClassName = intro ? ' editor-crop-mask-intro' : '';
  const cropRadius = 100 * getEditorCropRadiusRatio(100);
  const maskId = `crop-mask-${maskInstanceId}`;
  const circleClipId = `crop-circle-clip-${maskInstanceId}`;
  const guideStroke = active ? 'rgba(218, 255, 252, 0.78)' : 'rgba(218, 255, 252, 0.56)';

  return (
    <svg
      viewBox="0 0 100 100"
      className={`editor-crop-mask h-full w-full overflow-visible${introClassName}`}
      aria-hidden="true"
    >
      <defs>
        <mask id={maskId}>
          <rect x={-overlayBleed} y={-overlayBleed} width={100 + overlayBleed * 2} height={100 + overlayBleed * 2} fill="white" />
          <circle cx="50" cy="50" r={cropRadius} fill="black" />
        </mask>
        <clipPath id={circleClipId}>
          <circle cx="50" cy="50" r={cropRadius} />
        </clipPath>
      </defs>

      <g>
        <rect
          x={-overlayBleed}
          y={-overlayBleed}
          width={100 + overlayBleed * 2}
          height={100 + overlayBleed * 2}
          fill={overlayColor}
          mask={`url(#${maskId})`}
        />
      </g>
      <g clipPath={`url(#${circleClipId})`}>
        <line
          x1="50"
          y1={50 - cropRadius}
          x2="50"
          y2={50 + cropRadius}
          stroke={guideStroke}
          strokeWidth="0.8"
          strokeDasharray="2.4 2.4"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={50 - cropRadius}
          y1="50"
          x2={50 + cropRadius}
          y2="50"
          stroke={guideStroke}
          strokeWidth="0.8"
          strokeDasharray="2.4 2.4"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </g>
    </svg>
  );
}