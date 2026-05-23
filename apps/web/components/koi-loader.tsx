"use client";

import { clsx } from "clsx";
import { useEffect, useRef } from "react";

const WATER_COLOR = "#c8deff";
const CREDIT_LINE = "Designed by Nepal Koi Tech";
const KOI_LOGO_SRC = "/just-icon.svg";

function KoiCanvas({
  className,
  size,
}: {
  className?: string;
  size: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) {
      return;
    }

    const context = canvasElement.getContext("2d");
    if (!context) {
      return;
    }

    const canvas = canvasElement;
    const ctx = context;

    const fish = new Image();
    fish.decoding = "async";
    fish.src = KOI_LOGO_SRC;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let animationFrame = 0;
    let stopped = false;

    const cfg = {
      cssSize: size,
      orbitDuration: 2600,
      radiusCycleDuration: 5200,
      waterLevel: 0.52,
      semicircleColor: WATER_COLOR,
      fishScale: 0.34,
      smallRadius: 0.22,
      largeRadius: 0.34,
      underwaterOpacity: 0.45,
      rotationOffset: -Math.PI / 6,
      pivotX: 0.78,
      pivotY: 0.47,
    };

    function fitCanvas() {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cfg.cssSize = size;
    }

    function easeInOutSine(t: number) {
      return -(Math.cos(Math.PI * t) - 1) / 2;
    }

    function getFishPose(ms: number) {
      const orbitPhase = (ms % cfg.orbitDuration) / cfg.orbitDuration;
      const radiusPhase = (ms % cfg.radiusCycleDuration) / cfg.radiusCycleDuration;
      const radiusMix = easeInOutSine(
        radiusPhase < 0.5 ? radiusPhase * 2 : (1 - radiusPhase) * 2,
      );
      const radius =
        cfg.cssSize * (cfg.smallRadius + (cfg.largeRadius - cfg.smallRadius) * radiusMix);
      const angle = Math.PI / 2 + orbitPhase * Math.PI * 2;
      const x = cfg.cssSize * 0.5 + Math.cos(angle) * radius;
      const y = cfg.cssSize * 0.5 + Math.sin(angle) * radius;
      const wobble = Math.sin(orbitPhase * Math.PI * 2) * 0.18;
      const rotation = angle + Math.PI / 2 + cfg.rotationOffset + wobble;
      const aboveWater = y < cfg.cssSize * cfg.waterLevel;
      const scale = cfg.fishScale * (aboveWater ? 1.08 : 0.94) * (0.96 + radiusMix * 0.08);

      return { x, y, rotation, scale };
    }

    function drawWater(waterY: number) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cfg.cssSize / 2, waterY, cfg.cssSize / 2, 0, Math.PI, false);
      ctx.closePath();
      ctx.fillStyle = cfg.semicircleColor;
      ctx.fill();
      ctx.restore();
    }

    function drawFishClipped(
      waterY: number,
      pose: ReturnType<typeof getFishPose>,
      mode: "above" | "below",
    ) {
      const sourceW = fish.naturalWidth || 1500;
      const sourceH = fish.naturalHeight || 1500;
      const drawW = cfg.cssSize * pose.scale;
      const drawH = drawW * (sourceH / sourceW);
      const pivotX = drawW * cfg.pivotX;
      const pivotY = drawH * cfg.pivotY;

      ctx.save();

      if (mode === "above") {
        ctx.beginPath();
        ctx.rect(-cfg.cssSize, -cfg.cssSize, cfg.cssSize * 3, waterY + cfg.cssSize);
        ctx.clip();
        ctx.globalAlpha = 1;
        ctx.filter = "none";
      } else {
        ctx.beginPath();
        ctx.rect(-cfg.cssSize, waterY, cfg.cssSize * 3, cfg.cssSize * 3);
        ctx.clip();
        ctx.globalAlpha = cfg.underwaterOpacity;
        ctx.filter = `blur(${Math.max(1, cfg.cssSize * 0.017)}px)`;
      }

      ctx.translate(pose.x, pose.y);
      ctx.rotate(pose.rotation);
      ctx.drawImage(fish, -pivotX, -pivotY, drawW, drawH);
      ctx.restore();

      ctx.globalAlpha = 1;
      ctx.filter = "none";
    }

    function draw(timestamp: number) {
      const waterY = cfg.cssSize * cfg.waterLevel;
      const elapsed = reduceMotion ? cfg.orbitDuration * 0.2 : timestamp;
      const pose = getFishPose(elapsed);

      ctx.clearRect(0, 0, cfg.cssSize, cfg.cssSize);
      drawWater(waterY);
      drawFishClipped(waterY, pose, "below");
      drawFishClipped(waterY, pose, "above");

      if (!reduceMotion && !stopped) {
        animationFrame = window.requestAnimationFrame(draw);
      }
    }

    function start() {
      fitCanvas();
      animationFrame = window.requestAnimationFrame(draw);
    }

    const handleResize = () => fitCanvas();
    window.addEventListener("resize", handleResize);

    if (fish.complete) {
      start();
    } else {
      fish.onload = () => {
        if (!stopped) {
          start();
        }
      };
    }

    return () => {
      stopped = true;
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", handleResize);
      fish.onload = null;
    };
  }, [size]);

  return <canvas aria-hidden="true" className={className} ref={canvasRef} />;
}

function LoaderText({
  label,
  credit = CREDIT_LINE,
  compact = false,
}: {
  label: string;
  credit?: string;
  compact?: boolean;
}) {
  return (
    <div className="space-y-1 text-center">
      <div
        className={clsx(
          "text-[var(--foreground)]",
          compact ? "text-sm font-medium" : "text-base font-medium",
        )}
      >
        {label}
      </div>
      <div
        className={clsx(
          "uppercase tracking-[0.18em] text-[var(--text-muted)]",
          compact ? "text-[10px] font-semibold" : "text-xs font-semibold",
        )}
      >
        {credit}
      </div>
    </div>
  );
}

export function KoiPageLoader({
  label = "Loading",
  credit = CREDIT_LINE,
}: {
  label?: string;
  credit?: string;
}) {
  return (
    <div className="flex min-h-[48vh] flex-col items-center justify-center gap-4">
      <KoiCanvas size={112} />
      <LoaderText credit={credit} label={label} />
    </div>
  );
}

export function KoiSectionLoader({
  label = "Loading",
  credit = CREDIT_LINE,
  className,
}: {
  label?: string;
  credit?: string;
  className?: string;
}) {
  return (
    <div
      className={clsx("flex min-h-[220px] flex-col items-center justify-center gap-3", className)}
    >
      <KoiCanvas size={84} />
      <LoaderText compact credit={credit} label={label} />
    </div>
  );
}

export function KoiInlineLoader({
  label = "Loading",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div className={clsx("flex flex-col items-center justify-center gap-2 py-4", className)}>
      <KoiCanvas size={64} />
      <LoaderText compact label={label} />
    </div>
  );
}

export function KoiButtonLoader({
  className,
}: {
  className?: string;
}) {
  return (
    <span aria-hidden="true" className={clsx("inline-flex items-center", className)}>
      <KoiCanvas size={28} />
    </span>
  );
}
