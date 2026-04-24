"use client";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowUp,
  Brain,
  Check,
  GitBranch,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Crop,
  Download,
  Image as ImageIcon,
  Info,
  Maximize,
  MessageSquare,
  Mic,
  Minus,
  MousePointer2,
  PenTool,
  Plus,
  PlusCircle,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Tag,
  Type,
  Video,
  AudioLines,
  ZoomIn,
  Loader2,
  X,
  Play,
  PenLine,
  PieChart,
  Eraser,
  Palette,
  LayoutGrid,
  ExternalLink,
  Flag,
  LayoutTemplate,
  Droplet,
  MoreHorizontal,
  AppWindow,
  Scissors,
  Upload,
  Copy,
} from "lucide-react";

const WORLD_W = 8000;
const WORLD_H = 6000;
const WORLD_CX = WORLD_W / 2;
const WORLD_CY = WORLD_H / 2;
const MARQUEE_DRAG_THRESHOLD_PX = 6;
const ZOOM_MIN = 0.02;
const ZOOM_MAX = 8;
const DEFAULT_ZOOM = 0.52;
/** One discrete zoom step (buttons / ⌘+/−); larger = bigger jump per click */
const ZOOM_STEP_RATIO = 1.3;
/** Pinch / Ctrl+wheel sensitivity; larger = faster zoom per wheel tick */
const ZOOM_WHEEL_SENS = 0.0034;

/** Matches chat: `w-[400px]` + `right-4` (1rem) — canvas never sits under the AI panel */

/**
 * Vocabulary (use these names consistently in code + product copy):
 * - **frame** — the white rounded shell (`bg-white`); same chrome for every frame on the board.
 * - **workplace** — the outer dashed boundary that wraps a frame (the “dots border” region on the canvas).
 */

function formatGenerateApiError(data: {
  error?: unknown;
  hint?: string;
}): string {
  const e = data.error;
  if (typeof e === "string" && e.trim()) {
    return data.hint ? `${e}\n\n${data.hint}` : e;
  }
  if (e && typeof e === "object" && "message" in e) {
    const msg = String((e as { message: unknown }).message);
    if (msg) {
      return data.hint ? `${msg}\n\n${data.hint}` : msg;
    }
  }
  return "生成失败，请查看网络请求或控制台。";
}

async function generateImageViaGateway(
  prompt: string,
  image?: string,
  styleImage?: string,
): Promise<{ imageUrl: string; frameName?: string; actionSummary?: string }> {
  const USE_GATEWAY = true;
  if (!USE_GATEWAY) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    return {
      imageUrl:
        image ||
        "https://images.unsplash.com/photo-1583337130417-3346a1be7dee?auto=format&fit=crop&w=512&h=512&q=80",
      frameName: "Generated Placeholder",
      actionSummary: `AI interpretation: apply "${prompt.trim() || "your request"}" to generate an updated visual result.`,
    };
  }

  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      ...(image ? { image } : {}),
      ...(styleImage ? { styleImage } : {}),
    }),
  });

  const data = (await res.json()) as {
    imageUrl?: string;
    frameName?: string;
    actionSummary?: string;
    error?: unknown;
    hint?: string;
  };

  if (!res.ok || !data.imageUrl) {
    throw new Error(formatGenerateApiError(data));
  }
  return { imageUrl: data.imageUrl, frameName: data.frameName, actionSummary: data.actionSummary };
}

type ImageAsset = { id: string; src: string; alt: string };
type StickyNoteAsset = {
  id: string;
  title: string;
  message: string;
  footer: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
type ClipAsset = {
  id: string;
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};
type SourceRef = {
  level: "image" | "frame" | "workspace";
  workspaceId: string;
  frameId?: string;
  assetId?: string;
};
type Frame = {
  id: string;
  name?: string;
  assets: ImageAsset[];
  status: "ready" | "generating" | "error";
  boardType?: "reference" | "mood";
  prompt?: string;
  errorMessage?: string;
  sourceRef?: SourceRef;
};
type Workspace = { 
  id: string; 
  title: string; 
  frames: Frame[];
  isStandalone?: boolean;
  x?: number;
  y?: number;
};
type FeedbackStage =
  | "analyzing"
  | "generating"
  | "refining"
  | "finalizing"
  | "done"
  | "error";
export const PROMPT_FRAMEWORKS = [
  {
    id: "apply-style",
    lead: "Apply style",
    trail: " from image",
    searchText: "apply style from image",
  },
  {
    id: "blend",
    lead: "Blend",
    trail: " with image",
    searchText: "blend with image",
  },
  {
    id: "image-ratio",
    lead: "Image ratio",
    trail: ":width:height",
    searchText: "image ratio width height",
  },
  {
    id: "cmd-1",
    lead: "command placeholder",
    trail: "",
    searchText: "command placeholder",
    disabled: true,
  },
  {
    id: "cmd-2",
    lead: "command placeholder",
    trail: "",
    searchText: "command placeholder",
    disabled: true,
  },
  {
    id: "cmd-3",
    lead: "command placeholder",
    trail: "",
    searchText: "command placeholder",
    disabled: true,
  },
];

type InlineFeedback = {
  id: string;
  prompt: string;
  scope: "image" | "frame" | "workspace";
  status: FeedbackStage;
  assetCount: number;
  selectedCount: number;
  stageHistory: FeedbackStage[];
  showProcess: boolean;
  frameName?: string;
  actionSummary?: string;
  workspaceId?: string;
  frameId?: string;
  outputAssets?: ImageAsset[];
  inputAsset?: ImageAsset;
  styleRefSrc?: string;
  frameworkId?: string;
  ratioWidth?: string;
  ratioHeight?: string;
  promptFrameLines?: string[];
  userPromptInput?: string;
  errorMessage?: string;
};

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeFrameNameFromPrompt(prompt: string): string {
  const normalized = prompt
    .replace(/\[[^\]]*Instruction\]:/gi, " ")
    .replace(/Additional user prompt:\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const firstChunk =
    normalized
      .split(/[\n.;]/)
      .map((s) => s.trim())
      .find((s) => s.length > 0) ?? "Untitled";
  return firstChunk.length > 36 ? `${firstChunk.slice(0, 36)}…` : firstChunk;
}

function pickReadableFrameName(args: {
  modelFrameName?: string;
  userPromptInput?: string;
  promptFrameLines?: string[];
  fallbackPrompt: string;
}): string {
  const { modelFrameName, userPromptInput, promptFrameLines, fallbackPrompt } = args;
  const candidate = modelFrameName?.trim();
  const looksInstructionLike =
    !candidate ||
    /instruction|apply style|blend with image|adjust image ratio|generating title/i.test(candidate);
  if (!looksInstructionLike) return candidate;
  if (userPromptInput?.trim()) return makeFrameNameFromPrompt(userPromptInput);
  if (promptFrameLines && promptFrameLines.length > 0) {
    return makeFrameNameFromPrompt(promptFrameLines.join("; "));
  }
  return makeFrameNameFromPrompt(fallbackPrompt);
}

const FEEDBACK_STAGE_ORDER: FeedbackStage[] = [
  "analyzing",
  "generating",
  "refining",
  "finalizing",
];

function stageLabel(stage: FeedbackStage): string {
  if (stage === "analyzing") return "Analyzing request";
  if (stage === "generating") return "Generating variations";
  if (stage === "refining") return "Refining composition";
  if (stage === "finalizing") return "Finalizing outputs";
  if (stage === "done") return "Generation complete";
  return "Generation failed";
}

function summarizeChanges(scope: "image" | "frame" | "workspace", assetCount: number): string {
  if (scope === "image") {
    return "Reworked one selected image while preserving the original framing and style intent.";
  }
  if (scope === "frame") {
    return `Applied the prompt across ${assetCount} image(s) in this frame, keeping the set visually consistent.`;
  }
  return `Applied the prompt at workspace scope and produced a refreshed set of ${assetCount} image output(s).`;
}

async function toDataUrlFromSrc(src: string): Promise<string> {
  if (src.startsWith("data:")) return src;
  const absolute = src.startsWith("http")
    ? src
    : new URL(src, window.location.origin).href;
  const res = await fetch(absolute);
  if (!res.ok) {
    throw new Error(`Unable to fetch reference image: ${res.status}`);
  }
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read image blob"));
    reader.readAsDataURL(blob);
  });
}

const INITIAL_WORKSPACES: Workspace[] = [
  {
    id: "ws-1",
    title: "Corgi Game Character",
    frames: [
      {
        id: "f-1",
        name: "Corgi Game Character",
        status: "ready",
        assets: [
          {
            id: "img-1",
            src: "/corgi-wizard.png",
            alt: "Corgi game character — wizard",
          },
          {
            id: "img-2",
            src: "/corgi-chef.png",
            alt: "Corgi game character — chef",
          },
          {
            id: "img-3",
            src: "/corgi-pirate.png",
            alt: "Corgi game character — pirate",
          },
        ],
      },
    ],
  },
];

const INITIAL_STICKY_NOTES: StickyNoteAsset[] = [
  {
    id: "sn-1",
    title: "Design with heart",
    message: "Image model tokens may run out.\nIf that happens, please contact Ella!",
    footer: "Thanks for your time!",
    x: WORLD_CX - 640,
    y: WORLD_CY - 340,
    width: 260,
    height: 260,
  },
];

function ToolbarIconBtn({
  label,
  children,
  onClick,
  active = false,
  disabled = false,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`rounded-full p-1 transition-colors ${
        disabled
          ? "cursor-not-allowed text-neutral-300"
          : ""
      } ${
        active
          ? "bg-neutral-900 text-white"
          : disabled
            ? ""
            : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
      }`}
    >
      {children}
    </button>
  );
}

function GenerationTitlePill({
  prompt,
  canvasZoom,
}: {
  prompt: string;
  canvasZoom: number;
}) {
  const inv = 1 / Math.max(canvasZoom, 0.001);
  return (
    <div className="origin-bottom-left" style={{ transform: `scale(${inv})` }}>
      <div className="inline-flex max-w-full items-center gap-2 rounded-full bg-black px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm sm:text-xs">
        <span className="max-w-[118px] truncate">{prompt}</span>
        <span className="feedback-dots inline-flex items-center gap-1">
          <span className="h-1 w-1 rounded-full bg-[#60a5fa]" />
          <span className="h-1 w-1 rounded-full bg-[#60a5fa]" />
          <span className="h-1 w-1 rounded-full bg-[#60a5fa]" />
        </span>
      </div>
    </div>
  );
}

function AnimatedEllipsis() {
  return (
    <span className="feedback-dots ml-1 inline-flex items-center gap-0.5 align-middle">
      <span className="h-1 w-1 rounded-full bg-current" />
      <span className="h-1 w-1 rounded-full bg-current" />
      <span className="h-1 w-1 rounded-full bg-current" />
    </span>
  );
}

function GenerationFeedbackFrame({
  isGenerating,
  errorMessage,
}: {
  isGenerating: boolean;
  errorMessage?: string;
}) {
  return (
    <div className="relative h-32 w-32 overflow-hidden rounded-[14px] bg-[#ececec] sm:h-36 sm:w-36">
      {isGenerating ? <div className="feedback-shimmer absolute inset-0" /> : null}
      <div className="absolute inset-0 flex items-center justify-center">
        <ImageIcon className="text-neutral-400/80" size={34} strokeWidth={1.6} />
      </div>
      {!isGenerating && errorMessage && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/90 p-2 text-center text-xs text-red-600">
          {errorMessage}
        </div>
      )}
    </div>
  );
}

function ImageEditToolbar({
  canvasZoom,
  isPathView,
  onTogglePathView,
  onOpenClip,
}: {
  canvasZoom: number;
  isPathView: boolean;
  onTogglePathView: () => void;
  onOpenClip: () => void;
}) {
  const inv = 1 / Math.max(canvasZoom, 0.001);
  const iconProps = { size: 14 as const, strokeWidth: 2 };
  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 z-[300] mb-5 flex w-0 justify-center">
      <div
        className="origin-bottom"
        style={{ transform: `scale(${inv})` }}
      >
        <div
          data-floating-toolbar
          className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-neutral-200 bg-white px-3 py-1.5 shadow-md"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <ToolbarIconBtn label="Reload" disabled>
            <RefreshCw {...iconProps} />
          </ToolbarIconBtn>
          <ToolbarIconBtn label="Zoom in" disabled>
            <ZoomIn {...iconProps} />
          </ToolbarIconBtn>
          <ToolbarIconBtn label="Download" disabled>
            <Download {...iconProps} />
          </ToolbarIconBtn>
          <ToolbarIconBtn label="Tag" disabled>
            <Tag {...iconProps} />
          </ToolbarIconBtn>
          <ToolbarIconBtn label="Crop clip" onClick={onOpenClip}>
            <Scissors {...iconProps} />
          </ToolbarIconBtn>
          <ToolbarIconBtn label="Info" disabled>
            <Info {...iconProps} />
          </ToolbarIconBtn>
          <ToolbarIconBtn
            label="Lineage path view"
            onClick={onTogglePathView}
            active={isPathView}
          >
            <GitBranch {...iconProps} />
          </ToolbarIconBtn>
        </div>
      </div>
    </div>
  );
}

/** Same shell + counter-scale as frame title; send circle follows input (gray → black) */
function ImageInlineChat({
  canvasZoom,
  sourceAssets,
  allAssets,
  onStart,
  onSuccess,
  onStageChange,
  onError,
  isPickingStyle,
  onStartPickingStyle,
  onStopPickingStyle,
}: {
  canvasZoom: number;
  sourceAssets: ImageAsset[];
  allAssets: ImageAsset[];
  onStart?: (
    prompt: string,
    meta?: {
      inputAsset?: ImageAsset;
      styleRefSrc?: string;
      frameworkId?: string | null;
      ratioWidth?: string;
      ratioHeight?: string;
      promptFrameLines?: string[];
      userPromptInput?: string;
    },
  ) => string;
  onSuccess: (
    prompt: string,
    assets: ImageAsset[],
    frameName?: string,
    frameId?: string,
    actionSummary?: string,
  ) => void;
  onStageChange?: (frameId: string | undefined, stage: FeedbackStage) => void;
  onError?: (message: string, frameId?: string) => void;
  isPickingStyle?: boolean;
  onStartPickingStyle?: () => void;
  onStopPickingStyle?: () => void;
}) {
  const [message, setMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [inputHeight, setInputHeight] = useState(20);
  const [selectedFramework, setSelectedFramework] = useState<string | null>(null);
  const [selectedFrameworkQueue, setSelectedFrameworkQueue] = useState<string[]>([]);
  const [composerSequence, setComposerSequence] = useState<
    Array<{ type: "text"; text: string } | { type: "token"; id: string }>
  >([]);
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [ratioWidth, setRatioWidth] = useState("1");
  const [ratioHeight, setRatioHeight] = useState("1");
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const FRAMEWORKS = PROMPT_FRAMEWORKS;
  const inv = 1 / Math.max(canvasZoom, 0.001);
  const iconProps = { size: 14 as const, strokeWidth: 2 };
  const hasStyleLikeFrame = selectedFrameworkQueue.some(
    (id) => id === "apply-style" || id === "blend",
  );
  const hasImageRatioFrame = selectedFrameworkQueue.includes("image-ratio");
  const canSend =
    !isGenerating &&
    (message.trim().length > 0 || selectedFrameworkQueue.length > 0 || composerSequence.length > 0) &&
    (!hasStyleLikeFrame || Boolean(referenceImage));

  const frameworkById = useMemo(() => Object.fromEntries(FRAMEWORKS.map((f) => [f.id, f])), [FRAMEWORKS]);

  const filteredFrameworks = useMemo(() => FRAMEWORKS, [FRAMEWORKS]);

  const predictedFramework = useMemo(() => {
    if (!message || message.includes("\n")) return filteredFrameworks.find((f) => !f.disabled) ?? null;
    const lowerInput = message.toLowerCase();
    return (
      filteredFrameworks.find((f) => {
        if (f.disabled) return false;
        const full = `${f.lead}${f.trail}`.toLowerCase();
        return full.startsWith(lowerInput);
      }) ?? null
    );
  }, [filteredFrameworks, message]);
  const tabCompletionSuffix = useMemo(() => {
    if (!predictedFramework || !message || message.includes("\n")) return "";
    const full = `${predictedFramework.lead}${predictedFramework.trail}`;
    const lowerFull = full.toLowerCase();
    const lowerInput = message.toLowerCase();
    if (!lowerFull.startsWith(lowerInput)) return "";
    return full.slice(message.length);
  }, [predictedFramework, message]);

  useEffect(() => {
    if (!isExpanded) return;
    const el = messageRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.max(20, Math.min(el.scrollHeight, 120));
    el.style.height = `${next}px`;
    setInputHeight(next);
  }, [isExpanded, message]);

  useEffect(() => {
    if (!isPickingStyle) return;
    const handlePick = (e: Event) => {
      const ce = e as CustomEvent;
      setReferenceImage(ce.detail);
      onStopPickingStyle?.();
    };
    window.addEventListener("style-picked", handlePick);
    return () => window.removeEventListener("style-picked", handlePick);
  }, [isPickingStyle, onStopPickingStyle]);

  const handleSend = async () => {
    if (!canSend) return;
    setIsGenerating(true);
    const pendingSequence = [
      ...composerSequence,
      ...(message.trim() ? [{ type: "text" as const, text: message.trim() }] : []),
    ];
    const userPromptInput = pendingSequence
      .filter((item): item is { type: "text"; text: string } => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    const rw = Number.parseInt(ratioWidth, 10);
    const rh = Number.parseInt(ratioHeight, 10);
    const safeW = Number.isFinite(rw) && rw > 0 ? rw : 1;
    const safeH = Number.isFinite(rh) && rh > 0 ? rh : 1;

    const promptFrameLines = pendingSequence
      .filter((item): item is { type: "token"; id: string } => item.type === "token")
      .map(({ id }) => {
        if (id === "apply-style") return "Apply style from image";
        if (id === "blend") return "Blend with image";
        if (id === "image-ratio") return `Adjust image ratio ${safeW}:${safeH}`;
        const fw = frameworkById[id];
        return fw ? `${fw.lead}${fw.trail ?? ""}`.trim() : null;
      })
      .filter((v): v is string => Boolean(v));

    const currentPrompt =
      userPromptInput || promptFrameLines.join("; ") || "Adjust image";

    const pendingFrameId = onStart?.(currentPrompt, {
      inputAsset: sourceAssets[0],
      styleRefSrc: hasStyleLikeFrame ? referenceImage ?? undefined : undefined,
      frameworkId: selectedFrameworkQueue.length > 0 ? selectedFrameworkQueue[selectedFrameworkQueue.length - 1] : selectedFramework,
      ratioWidth: hasImageRatioFrame ? String(safeW) : undefined,
      ratioHeight: hasImageRatioFrame ? String(safeH) : undefined,
      promptFrameLines,
      userPromptInput: userPromptInput || undefined,
    });
    try {
      const generatedAssets: ImageAsset[] = [];
      let frameName: string | undefined;
      let actionSummary: string | undefined;
      if (sourceAssets.length > 0) {
        for (let idx = 0; idx < sourceAssets.length; idx += 1) {
          const source = sourceAssets[idx];
          const sourceDataUrl = await toDataUrlFromSrc(source.src);
          let styleDataUrl: string | undefined = undefined;
          if (hasStyleLikeFrame && referenceImage) {
            styleDataUrl = await toDataUrlFromSrc(referenceImage);
          }

          const instructions: string[] = [];
          for (const item of pendingSequence) {
            if (item.type === "text") {
              instructions.push(`Additional user prompt: ${item.text}`);
              continue;
            }
            const id = item.id;
            if (id === "apply-style") {
              instructions.push(
                "You will receive two images in order. Image 1 is the target/base image (the image clicked right now). Image 2 is the style reference image (uploaded or selected from canvas). Extract style from Image 2 and apply it to Image 1 only. Preserve Image 1 composition, layout, subject identity, and structure. Do not transfer structure from Image 2.",
              );
            } else if (id === "blend") {
              instructions.push(
                "You will receive two images, blend these images by combining their composition, colors, style, and subjects into a cohesive, unified result.",
              );
            } else if (id === "image-ratio") {
              instructions.push(
                `Use an exact output aspect ratio of ${safeW}:${safeH}. This ratio is mandatory. If needed, crop or expand canvas while preserving the main subject.`,
              );
            }
          }

          const finalPrompt = instructions.length > 0 ? instructions.join(" ") : currentPrompt;
          const generated = await generateImageViaGateway(finalPrompt, sourceDataUrl, styleDataUrl);
          frameName = frameName ?? generated.frameName;
          actionSummary = actionSummary ?? generated.actionSummary;
          generatedAssets.push({
            id: makeId("img"),
            src: generated.imageUrl,
            alt: `${currentPrompt} (${idx + 1})`,
          });
        }
      } else {
        const instructions: string[] = [];
        for (const item of pendingSequence) {
          if (item.type === "text") {
            instructions.push(`Additional user prompt: ${item.text}`);
            continue;
          }
          if (item.id === "image-ratio") {
            instructions.push(
              `Use an exact output aspect ratio of ${safeW}:${safeH}. This ratio is mandatory. If needed, crop or expand canvas while preserving the main subject.`,
            );
          }
        }
        const finalPrompt = instructions.length > 0 ? instructions.join(" ") : currentPrompt;
        const generated = await generateImageViaGateway(finalPrompt);
        frameName = generated.frameName;
        actionSummary = generated.actionSummary;
        generatedAssets.push({
          id: makeId("img"),
          src: generated.imageUrl,
          alt: currentPrompt,
        });
      }
      // Run mock progress only after generation is done.
      onStageChange?.(pendingFrameId, "generating");
      await wait(POST_GENERATION_STEP_DELAY_MS);
      onStageChange?.(pendingFrameId, "refining");
      await wait(POST_GENERATION_STEP_DELAY_MS);
      onStageChange?.(pendingFrameId, "finalizing");
      await wait(POST_GENERATION_STEP_DELAY_MS);
      const resolvedFrameName = pickReadableFrameName({
        modelFrameName: frameName,
        userPromptInput: userPromptInput || undefined,
        promptFrameLines,
        fallbackPrompt: currentPrompt,
      });
      onSuccess(currentPrompt, generatedAssets, resolvedFrameName, pendingFrameId, actionSummary);
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "网络错误，请稍后重试。";
      onError?.(msg, pendingFrameId);
    } finally {
      setIsGenerating(false);
      setMessage("");
      setSelectedFramework(null);
      setSelectedFrameworkQueue([]);
      setComposerSequence([]);
      setReferenceImage(null);
      setShowImagePicker(false);
      setInputHeight(20);
      setIsExpanded(false);
      onStopPickingStyle?.();
    }
  };

  return (
    <div className="pointer-events-none absolute top-full left-1/2 z-[300] mt-5 flex w-0 justify-center">
      <div className="origin-top" style={{ transform: `scale(${inv})` }}>
        {isExpanded ? (
          <div className="relative">
            {filteredFrameworks.length > 0 && (
              <div
                data-prompt-framework
                className="absolute top-[calc(100%+8px)] left-0 w-[min(15rem,78vw)] max-w-[18rem] max-h-[140px] rounded-xl bg-white shadow-lg border border-neutral-200 overflow-y-auto text-[13px] py-2 pointer-events-auto [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-track]:my-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-neutral-300 [&::-webkit-scrollbar-thumb]:border-[3px] [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:bg-clip-padding [&::-webkit-scrollbar-thumb]:rounded-full"
              >
                {filteredFrameworks.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    disabled={f.disabled}
                    className={`w-full text-left px-3 py-1 hover:bg-neutral-100 ${f.disabled ? "text-neutral-300" : "text-neutral-900"}`}
                    onClick={() => {
                      setSelectedFramework(f.id);
                      setSelectedFrameworkQueue((prev) => [...prev, f.id]);
                      setComposerSequence((prev) => [
                        ...prev,
                        ...(message.trim() ? [{ type: "text" as const, text: message.trim() }] : []),
                        { type: "token" as const, id: f.id },
                      ]);
                      if (message.trim()) setMessage("");
                    }}
                  >
                    <span className={f.disabled ? "font-normal" : "font-bold"}>{f.lead}</span>
                    {f.trail ? <span className="font-normal text-neutral-400">{f.trail}</span> : null}
                  </button>
                ))}
              </div>
            )}
            <div
              data-image-inline-chat
              className="pointer-events-auto flex w-[min(15rem,78vw)] max-w-[18rem] flex-col gap-0.5 rounded-[24px] border border-neutral-200 bg-white px-3 py-[6px] shadow-md"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {composerSequence.map((item, idx) => {
                if (item.type === "text") {
                  return (
                    <p key={`text-${idx}`} className="whitespace-pre-wrap break-words text-[13px] text-neutral-900">
                      {item.text}
                    </p>
                  );
                }
                const id = item.id;
                const fw = frameworkById[id];
                if (!fw) return null;
                const styleLike = id === "apply-style" || id === "blend";
                const ratioLike = id === "image-ratio";
                return (
                  <div key={`token-${idx}`} className="flex min-h-6 min-w-0 w-full items-center gap-2">
                    <span className="text-[13px] font-medium whitespace-nowrap text-neutral-900">
                      {styleLike ? (id === "blend" ? "Blend with" : "Apply the style from") : fw.lead}
                    </span>
                    {ratioLike ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          inputMode="numeric"
                          value={ratioWidth}
                          onChange={(e) => setRatioWidth(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
                          className="h-6 w-8 rounded border border-neutral-300 bg-white px-1 text-center text-[12px] text-neutral-800 outline-none focus:border-neutral-500"
                          aria-label="Image ratio width"
                        />
                        <span className="text-neutral-500 text-[12px]">:</span>
                        <input
                          inputMode="numeric"
                          value={ratioHeight}
                          onChange={(e) => setRatioHeight(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
                          className="h-6 w-8 rounded border border-neutral-300 bg-white px-1 text-center text-[12px] text-neutral-800 outline-none focus:border-neutral-500"
                          aria-label="Image ratio height"
                        />
                      </div>
                    ) : null}
                    {!styleLike && !ratioLike && fw.trail ? (
                      <span className="text-[13px] text-neutral-500">{fw.trail}</span>
                    ) : null}
                    {styleLike ? (
                      <div className="relative">
                        <div
                          className="relative flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded border border-dashed border-neutral-300 hover:border-neutral-400 hover:bg-neutral-50 transition-colors"
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            const file = e.dataTransfer.files[0];
                            if (file) {
                              setReferenceImage(URL.createObjectURL(file));
                            } else {
                              const html = e.dataTransfer.getData("text/html");
                              if (html) {
                                const match = html.match(/src="([^"]+)"/);
                                if (match) setReferenceImage(match[1]);
                              } else {
                                const uri = e.dataTransfer.getData("text/uri-list");
                                if (uri) setReferenceImage(uri);
                              }
                            }
                          }}
                          onClick={() => setShowImagePicker((v) => !v)}
                        >
                          {referenceImage ? (
                            <img src={referenceImage} className="h-full w-full object-cover" alt="reference" />
                          ) : (
                            <ImageIcon size={12} className="text-neutral-400" />
                          )}
                        </div>
                        {showImagePicker && (
                          <div className="absolute bottom-[calc(100%+8px)] left-0 w-[200px] rounded-xl bg-white shadow-lg border border-neutral-200 overflow-hidden text-[13px] z-[400] flex flex-col">
                            <button
                              type="button"
                              className="w-full text-left px-3 py-2.5 hover:bg-neutral-100 font-medium text-neutral-900 border-b border-neutral-100 flex items-center gap-2"
                              onClick={() => {
                                fileInputRef.current?.click();
                                setShowImagePicker(false);
                              }}
                            >
                              <Upload size={14} className="text-neutral-500" /> Upload from computer
                            </button>
                            <button
                              type="button"
                              className="w-full text-left px-3 py-2.5 hover:bg-neutral-100 font-medium text-neutral-900 flex items-center gap-2"
                              onClick={() => {
                                onStartPickingStyle?.();
                                setShowImagePicker(false);
                              }}
                            >
                              <MousePointer2 size={14} className="text-neutral-500" /> Select from canvas
                            </button>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setReferenceImage(URL.createObjectURL(file));
                  }
                }}
              />
              <div
                className={`flex min-h-[22px] min-w-0 w-full items-center gap-2.5 ${
                  message.trim().length > 0 ? "order-1" : "order-2"
                }`}
              >
                <div className="relative min-w-0 flex-1 flex self-center">
                  {tabCompletionSuffix ? (
                    <div
                      className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre font-sans text-[13px] leading-[20px]"
                      aria-hidden
                    >
                      <span className="opacity-0">{message}</span>
                      <span className="text-neutral-300">{tabCompletionSuffix}</span>
                    </div>
                  ) : null}
                  <textarea
                  ref={messageRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Tab" && predictedFramework && !isGenerating) {
                      e.preventDefault();
                      setSelectedFramework(predictedFramework.id);
                      setSelectedFrameworkQueue((prev) => [...prev, predictedFramework.id]);
                      setComposerSequence((prev) => [
                        ...prev,
                        { type: "token" as const, id: predictedFramework.id },
                      ]);
                      setMessage("");
                      return;
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                    if (e.key === "Escape" && !isGenerating) {
                      setIsExpanded(false);
                      onStopPickingStyle?.();
                      return;
                    }
                    if (
                      composerSequence.length > 0 &&
                      message === "" &&
                      (e.key === "Backspace" || e.key === "Delete")
                    ) {
                      e.preventDefault();
                      setComposerSequence((prev) => {
                        const next = prev.slice(0, -1);
                        const removed = prev[prev.length - 1];
                        if (removed?.type === "text") {
                          setMessage(removed.text);
                          requestAnimationFrame(() => {
                            messageRef.current?.focus();
                            messageRef.current?.setSelectionRange(removed.text.length, removed.text.length);
                          });
                        }

                        const nextTokens = next
                          .filter((item): item is { type: "token"; id: string } => item.type === "token")
                          .map((item) => item.id);
                        setSelectedFrameworkQueue(nextTokens);
                        setSelectedFramework(nextTokens.length > 0 ? nextTokens[nextTokens.length - 1] : null);
                        if (!nextTokens.some((id) => id === "apply-style" || id === "blend")) {
                          setReferenceImage(null);
                        }
                        return next;
                      });
                    }
                  }}
                  placeholder={isGenerating ? "生成中…" : "Type..."}
                  disabled={isGenerating}
                  autoFocus
                  rows={1}
                  style={{ height: inputHeight }}
                  className="block min-h-[20px] m-0 min-w-0 w-full resize-none self-center overflow-y-auto border-0 bg-transparent px-0 py-0 font-sans text-[13px] leading-[20px] text-neutral-900 caret-neutral-900 outline-none placeholder:text-neutral-400 focus:ring-0 disabled:opacity-50"
                  aria-label="Message"
                />
                </div>
                <ToolbarIconBtn label="Voice input" disabled>
                  <Mic {...iconProps} />
                </ToolbarIconBtn>
                <button
                  type="button"
                  aria-label="Send"
                  disabled={!canSend}
                  onClick={() => void handleSend()}
                  className="shrink-0 rounded-full p-1 text-white transition-colors disabled:cursor-default disabled:bg-neutral-300 disabled:opacity-100 enabled:bg-neutral-900 enabled:hover:bg-neutral-800"
                >
                  {isGenerating ? (
                    <Loader2 {...iconProps} className="animate-spin" />
                  ) : (
                    <ArrowUp {...iconProps} />
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div
            data-image-inline-chat
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(true);
            }}
            className="pointer-events-auto flex h-[34px] w-[min(5.75rem,40vw)] cursor-text items-center justify-start rounded-full border border-neutral-200 bg-white px-3 shadow-md"
          >
            <div className="relative min-w-0 flex-1 self-center pointer-events-none">
              <textarea
                value=""
                readOnly
                rows={1}
                placeholder="Type..."
                className="block min-h-[20px] m-0 min-w-0 w-full resize-none self-center overflow-hidden border-0 bg-transparent px-0 py-0 font-sans text-[13px] leading-[20px] text-neutral-900 outline-none placeholder:text-neutral-400 focus:ring-0"
                aria-label="Message"
                style={{ height: "20px" }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const POST_GENERATION_STEP_DELAY_MS = 450;

type CanvasView = {
  pan: { x: number; y: number };
  zoom: number;
};

type ResizeHandle = "nw" | "ne" | "sw" | "se" | "border";

/** Zoom toward (mx, my) in viewport space; always derive from latest view (fixes jump when wheel batches). */
function zoomViewTowardPoint(
  v: CanvasView,
  mx: number,
  my: number,
  newZoom: number,
): CanvasView {
  const z = v.zoom;
  const zz = clamp(newZoom, ZOOM_MIN, ZOOM_MAX);
  const wx = (mx - v.pan.x) / z;
  const wy = (my - v.pan.y) / z;
  return {
    zoom: zz,
    pan: { x: mx - wx * zz, y: my - wy * zz },
  };
}

function applyZoomAtViewportCenter(
  v: CanvasView,
  newZoom: number,
  el: HTMLDivElement | null,
): CanvasView {
  const nz = clamp(newZoom, ZOOM_MIN, ZOOM_MAX);
  if (!el) return { ...v, zoom: nz };
  return zoomViewTowardPoint(v, el.clientWidth / 2, el.clientHeight / 2, nz);
}

export default function Home() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const workspaceRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const frameRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const assetRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [view, setView] = useState<CanvasView>({
    pan: { x: 0, y: 0 },
    zoom: DEFAULT_ZOOM,
  });
  const [spaceDown, setSpaceDown] = useState(false);
  const [commandDown, setCommandDown] = useState(false);
  const [commandSelectLocked, setCommandSelectLocked] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  /** Selected image key `${workspaceId}|${frameId}|${assetId}` or null */
  const [selectedFrameImages, setSelectedFrameImages] = useState<string[]>([]);
  const selectedFrameImage = selectedFrameImages[0] || null;
  const [selectedFrame, setSelectedFrame] = useState<string | null>(null);
  const [selectedFrameKeys, setSelectedFrameKeys] = useState<string[]>([]);
  const [frameOffsets, setFrameOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const [draggingFrameKey, setDraggingFrameKey] = useState<string | null>(null);
  const [clipAssets, setClipAssets] = useState<ClipAsset[]>([]);
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [clipDraft, setClipDraft] = useState<{ src: string; imageKey: string } | null>(null);
  const [clipPathPoints, setClipPathPoints] = useState<Array<{ x: number; y: number }>>([]);
  const [isClipDrawing, setIsClipDrawing] = useState(false);
  const [hoveredWorkspace, setHoveredWorkspace] = useState<string | null>(null);
  const [hoveredFrame, setHoveredFrame] = useState<string | null>(null);
  const [hoveredFrameImage, setHoveredFrameImage] = useState<string | null>(null);
  const [editingFrameId, setEditingFrameId] = useState<string | null>(null);
  const [frameContextMenu, setFrameContextMenu] = useState<{
    x: number;
    y: number;
    workspaceId: string;
    frameId: string;
  } | null>(null);

  useEffect(() => {
    const handleClick = () => setFrameContextMenu(null);
    window.addEventListener("pointerdown", handleClick);
    return () => window.removeEventListener("pointerdown", handleClick);
  }, []);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null);
  const [isPathView, setIsPathView] = useState(false);
  const [imageSizes, setImageSizes] = useState<Record<string, number>>({});
  const [imageAspectRatios, setImageAspectRatios] = useState<Record<string, number>>({});
  const [lineageSegments, setLineageSegments] = useState<
    Array<{ workspaceId: string; fromX: number; fromY: number; toX: number; toY: number }>
  >([]);
  const [marqueeSelection, setMarqueeSelection] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);
  const [isMarqueeSelecting, setIsMarqueeSelecting] = useState(false);
  const dragLastRef = useRef({ x: 0, y: 0 });
  const clipImageRef = useRef<HTMLImageElement | null>(null);

  const [workspaces, setWorkspaces] = useState<Workspace[]>(INITIAL_WORKSPACES);
  const [stickyNotes, setStickyNotes] = useState<StickyNoteAsset[]>(INITIAL_STICKY_NOTES);
  const [pickingStyleTarget, setPickingStyleTarget] = useState<"inline" | "main" | null>(null);
  const allAssets = useMemo(
    () => workspaces.flatMap((w) => w.frames.flatMap((f) => f.assets)),
    [workspaces]
  );
  const activeContextFrame = useMemo(() => {
    if (!frameContextMenu) return null;
    const ws = workspaces.find((w) => w.id === frameContextMenu.workspaceId);
    if (!ws) return null;
    return ws.frames.find((f) => f.id === frameContextMenu.frameId) ?? null;
  }, [frameContextMenu, workspaces]);
  const [inlineFeedbacks, setInlineFeedbacks] = useState<InlineFeedback[]>([]);
  const feedbackListRef = useRef<HTMLDivElement>(null);
  const [mainPrompt, setMainPrompt] = useState("");
  const [isMainGenerating, setIsMainGenerating] = useState(false);
  const [mainSelectedFrameworkQueue, setMainSelectedFrameworkQueue] = useState<string[]>([]);
  const [mainReferenceImage, setMainReferenceImage] = useState<string | null>(null);
  const [mainShowImagePicker, setMainShowImagePicker] = useState(false);
  const [mainRatioWidth, setMainRatioWidth] = useState("1");
  const [mainRatioHeight, setMainRatioHeight] = useState("1");
  const mainFileInputRef = useRef<HTMLInputElement>(null);
  const mainMessageRef = useRef<HTMLTextAreaElement>(null);
  const mainFrameworkById = useMemo(
    () => Object.fromEntries(PROMPT_FRAMEWORKS.map((f) => [f.id, f])),
    [],
  );
  const isMainImageSelected = Boolean(selectedFrameImage);

  useEffect(() => {
    if (pickingStyleTarget !== "main") return;
    const handlePick = (e: Event) => {
      const ce = e as CustomEvent;
      setMainReferenceImage(ce.detail);
      setPickingStyleTarget(null);
    };
    window.addEventListener("style-picked", handlePick);
    return () => window.removeEventListener("style-picked", handlePick);
  }, [pickingStyleTarget]);

  useEffect(() => {
    if (isMainImageSelected) return;
    setMainSelectedFrameworkQueue([]);
    setMainReferenceImage(null);
    setMainShowImagePicker(false);
    setMainRatioWidth("1");
    setMainRatioHeight("1");
  }, [isMainImageSelected]);

  const mainFilteredFrameworks = useMemo(
    () => (isMainImageSelected ? PROMPT_FRAMEWORKS : []),
    [isMainImageSelected],
  );

  const mainPredictedFramework = useMemo(() => {
    if (!mainPrompt || mainPrompt.includes("\n")) {
      return mainFilteredFrameworks.find((f) => !f.disabled) ?? null;
    }
    const lowerInput = mainPrompt.toLowerCase();
    return (
      mainFilteredFrameworks.find((f) => {
        if (f.disabled) return false;
        const full = `${f.lead}${f.trail}`.toLowerCase();
        return full.startsWith(lowerInput);
      }) ?? null
    );
  }, [mainFilteredFrameworks, mainPrompt]);

  const mainTabCompletionSuffix = useMemo(() => {
    if (!isMainImageSelected) return "";
    if (!mainPredictedFramework || !mainPrompt || mainPrompt.includes("\n")) return "";
    const full = `${mainPredictedFramework.lead}${mainPredictedFramework.trail}`;
    const lowerFull = full.toLowerCase();
    const lowerInput = mainPrompt.toLowerCase();
    if (!lowerFull.startsWith(lowerInput)) return "";
    return full.slice(mainPrompt.length);
  }, [mainPredictedFramework, mainPrompt, isMainImageSelected]);

  const handleMainGenerate = async () => {
    if (!mainPrompt.trim() && mainSelectedFrameworkQueue.length === 0 || isMainGenerating) return;
    setIsMainGenerating(true);
    let finalPrompt = mainPrompt.trim();
    const hasApplyStyle = mainSelectedFrameworkQueue.includes("apply-style");
    const hasBlend = mainSelectedFrameworkQueue.includes("blend");
    const hasImageRatioFrame = mainSelectedFrameworkQueue.includes("image-ratio");
    let styleRefSrc: string | undefined = undefined;
    let finalRatioWidth: string | undefined = undefined;
    let finalRatioHeight: string | undefined = undefined;

    if (hasApplyStyle && mainReferenceImage) {
      finalPrompt += `\n\n[Apply Style Instruction]: You will receive two images in order. Image 1 is the target/base image (the image clicked right now). Image 2 is the style reference image (uploaded or selected from canvas). Extract style from Image 2 and apply it to Image 1 only. Preserve Image 1 composition, layout, subject identity, and structure. Do not transfer structure from Image 2.`;
      styleRefSrc = mainReferenceImage;
    }
    if (hasBlend && mainReferenceImage) {
      finalPrompt += `\n\n[Blend Instruction]: You will receive two images in order. Image 1 is the target/base image. Image 2 is the reference image. Blend these images by combining their composition, colors, style, and subjects into a cohesive, unified result.`;
      styleRefSrc = mainReferenceImage;
    }
    if (hasImageRatioFrame) {
      finalPrompt += `\n\n[Image Ratio Instruction]: MANDATORY: The generated image MUST have an exact aspect ratio of ${mainRatioWidth}:${mainRatioHeight}. Crop or expand the canvas if needed to achieve this exact ratio.`;
      finalRatioWidth = mainRatioWidth;
      finalRatioHeight = mainRatioHeight;
    }
    if (!finalPrompt.trim()) {
      if (hasApplyStyle) finalPrompt = "Apply style from image";
      else if (hasBlend) finalPrompt = "Blend with image";
      else if (hasImageRatioFrame) finalPrompt = "Adjust image ratio";
    }

    const prompt = finalPrompt;
    let targetWorkspaceId: string | null = null;
    let sourceRef: SourceRef | undefined;
    let sourceAssets: ImageAsset[] = [];

    if (selectedFrameImage) {
      const [workspaceId, frameId, assetId] = selectedFrameImage.split("|");
      const workspace = workspaces.find((ws) => ws.id === workspaceId);
      const frame = workspace?.frames.find((f) => f.id === frameId);
      const asset = frame?.assets.find((a) => a.id === assetId);
      if (workspace && frame && asset) {
        targetWorkspaceId = workspaceId;
        sourceRef = { level: "image", workspaceId, frameId, assetId };
        sourceAssets = [asset];
      }
    } else if (selectedFrame) {
      const [workspaceId, frameId] = selectedFrame.split("|");
      const workspace = workspaces.find((ws) => ws.id === workspaceId);
      const frame = workspace?.frames.find((f) => f.id === frameId);
      if (workspace && frame) {
        targetWorkspaceId = workspaceId;
        sourceRef = { level: "frame", workspaceId, frameId };
        sourceAssets = frame.assets;
      }
    } else if (selectedWorkspace) {
      const workspace = workspaces.find((ws) => ws.id === selectedWorkspace);
      if (workspace) {
        targetWorkspaceId = selectedWorkspace;
        sourceRef = { level: "workspace", workspaceId: selectedWorkspace };
        sourceAssets = workspace.frames.flatMap((f) => f.assets);
      }
    }

    const isScopedGeneration = Boolean(targetWorkspaceId);
    const pendingWorkspaceId = targetWorkspaceId ?? makeId("ws");
    const pendingFrameId = makeId("f");
    const mainPromptFrameLines = mainSelectedFrameworkQueue.map(id => {
      if (id === "apply-style") return "Apply style from image";
      if (id === "blend") return "Blend with image";
      if (id === "image-ratio") return `Adjust image ratio ${mainRatioWidth}:${mainRatioHeight}`;
      return "";
    }).filter(Boolean);
    const initialFrameName = pickReadableFrameName({
      modelFrameName: undefined,
      userPromptInput: mainPrompt.trim() || undefined,
      promptFrameLines: mainPromptFrameLines,
      fallbackPrompt: prompt,
    });
    const mainScope: "image" | "frame" | "workspace" =
      selectedFrameImage ? "image" : selectedFrame ? "frame" : "workspace";
    pushInlineFeedback(
      pendingFrameId,
      prompt,
      mainScope,
      Math.max(1, sourceAssets.length),
      sourceAssets[0],
      styleRefSrc,
      mainSelectedFrameworkQueue[mainSelectedFrameworkQueue.length - 1],
      finalRatioWidth,
      finalRatioHeight,
      mainPromptFrameLines,
      mainPrompt.trim()
    );
    if (!isScopedGeneration) {
      setWorkspaces((prev) => [
        ...prev,
        {
          id: pendingWorkspaceId,
          title: prompt.length > 20 ? `${prompt.slice(0, 20)}…` : prompt,
          frames: [
            {
              id: pendingFrameId,
            name: initialFrameName,
              status: "generating",
              prompt,
              assets: [],
            },
          ],
        },
      ]);
    } else {
      setWorkspaces((prev) =>
        prev.map((ws) =>
          ws.id !== pendingWorkspaceId
            ? ws
            : {
                ...ws,
                frames: [
                  ...ws.frames,
                  {
                    id: pendingFrameId,
                    name: initialFrameName,
                    status: "generating",
                    prompt,
                    assets: [],
                    sourceRef,
                  },
                ],
              },
        ),
      );
    }

    try {
      const generatedAssets: ImageAsset[] = [];
      let frameName: string | undefined;
      let actionSummary: string | undefined;
      if (sourceAssets.length > 0) {
        for (let idx = 0; idx < sourceAssets.length; idx += 1) {
          const source = sourceAssets[idx];
          const sourceDataUrl = await toDataUrlFromSrc(source.src);
          const generated = await generateImageViaGateway(prompt, sourceDataUrl);
          frameName = frameName ?? generated.frameName;
          actionSummary = actionSummary ?? generated.actionSummary;
          generatedAssets.push({
            id: makeId("img"),
            src: generated.imageUrl,
            alt: `${prompt} (${idx + 1})`,
          });
        }
      } else {
        const generated = await generateImageViaGateway(prompt);
        frameName = generated.frameName;
        actionSummary = generated.actionSummary;
        generatedAssets.push({ id: makeId("img"), src: generated.imageUrl, alt: prompt });
      }
      const resolvedFrameName = pickReadableFrameName({
        modelFrameName: frameName,
        userPromptInput: mainPrompt.trim() || undefined,
        promptFrameLines: mainPromptFrameLines,
        fallbackPrompt: prompt,
      });
      // Run mock progress only after generation is done.
      markInlineFeedbackStage(pendingFrameId, "generating");
      await wait(POST_GENERATION_STEP_DELAY_MS);
      markInlineFeedbackStage(pendingFrameId, "refining");
      await wait(POST_GENERATION_STEP_DELAY_MS);
      markInlineFeedbackStage(pendingFrameId, "finalizing");
      await wait(POST_GENERATION_STEP_DELAY_MS);

      setWorkspaces((prev) =>
        prev.map((ws) =>
          ws.id !== pendingWorkspaceId
            ? ws
            : {
                ...ws,
                frames: ws.frames.map((f) =>
                  f.id === pendingFrameId
                    ? {
                        ...f,
                        status: "ready",
                        name: resolvedFrameName ?? f.name,
                        assets: generatedAssets,
                      }
                    : f,
                ),
              },
        ),
      );
      setSelectedFrameImages([]);
      setSelectedFrame(`${pendingWorkspaceId}|${pendingFrameId}`);
      setSelectedWorkspace(null);
      markInlineFeedbackDone(
        pendingFrameId,
        resolvedFrameName,
        actionSummary,
        pendingWorkspaceId,
        pendingFrameId,
        generatedAssets,
      );
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "网络错误，请稍后重试。";
      setWorkspaces((prev) =>
        prev.map((ws) =>
          ws.id !== pendingWorkspaceId
            ? ws
            : {
                ...ws,
                frames: ws.frames.map((f) =>
                  f.id === pendingFrameId
                    ? {
                        ...f,
                        status: "error",
                        errorMessage: msg,
                      }
                    : f,
                ),
              },
        ),
      );
      markInlineFeedbackError(pendingFrameId, msg);
    } finally {
      setIsMainGenerating(false);
      setMainPrompt("");
      setMainSelectedFrameworkQueue([]);
      setMainReferenceImage(null);
      setMainRatioWidth("1");
      setMainRatioHeight("1");
    }
  };

  const handleInlineStartFrame = (
    workspaceId: string,
    prompt: string,
    sourceRef?: SourceRef,
  ): string => {
    const frameId = makeId("f");
    setWorkspaces((prev) =>
      prev.map((ws) => {
        if (ws.id !== workspaceId) return ws;
        const newFrame: Frame = {
          id: frameId,
          name: makeFrameNameFromPrompt(prompt),
          status: "generating",
          prompt,
          assets: [],
          sourceRef,
        };
        return { ...ws, frames: [...ws.frames, newFrame] };
      }),
    );
    queuePlaceFrameInWorkspaceGap(workspaceId, frameId);
    return frameId;
  };

  const handleInlineAddFrame = (
    workspaceId: string,
    assets: ImageAsset[],
    frameName?: string,
    frameId?: string,
  ) => {
    setWorkspaces((prev) =>
      prev.map((ws) => {
        if (ws.id !== workspaceId) return ws;
        if (!frameId) {
          const newFrameId = makeId("f");
          const newFrame: Frame = {
            id: newFrameId,
            name: frameName,
            status: "ready",
            assets,
          };
          queuePlaceFrameInWorkspaceGap(workspaceId, newFrameId);
          return { ...ws, frames: [...ws.frames, newFrame] };
        }
        return {
          ...ws,
          frames: ws.frames.map((f) =>
            f.id === frameId
              ? {
                  ...f,
                  status: "ready",
                  name: frameName ?? f.name,
                  assets,
                }
              : f,
          ),
        };
      }),
    );
  };

  const pushInlineFeedback = (
    id: string,
    prompt: string,
    scope: "image" | "frame" | "workspace",
    assetCount: number,
    inputAsset?: ImageAsset,
    styleRefSrc?: string,
    frameworkId?: string | null,
    ratioWidth?: string,
    ratioHeight?: string,
    promptFrameLines?: string[],
    userPromptInput?: string,
  ) => {
    setInlineFeedbacks((prev) => [
      ...prev,
      {
        id,
        prompt,
        scope,
        status: "analyzing",
        assetCount,
        selectedCount: 1,
        stageHistory: ["analyzing"],
        showProcess: false,
        inputAsset,
        styleRefSrc,
        frameworkId: frameworkId ?? undefined,
        ratioWidth,
        ratioHeight,
        promptFrameLines,
        userPromptInput,
      },
    ]);
  };

  const queuePlaceFrameInWorkspaceGap = useCallback((workspaceId: string, frameId: string) => {
    window.requestAnimationFrame(() => {
      const frameKey = `${workspaceId}|${frameId}`;
      if (!frameRefs.current[frameKey]) return;
      // Keep generated frames in the workspace's normal vertical flow:
      // each new frame appears neatly below the previous one.
      setFrameOffsets((prev) => ({
        ...prev,
        [frameKey]: { x: 0, y: 0 },
      }));
    });
  }, []);

  const markInlineFeedbackStage = (id: string | undefined, stage: FeedbackStage) => {
    if (!id) return;
    setInlineFeedbacks((prev) =>
      prev.map((f) =>
        f.id === id
          ? {
              ...f,
              status: stage,
              stageHistory: f.stageHistory.includes(stage)
                ? f.stageHistory
                : [...f.stageHistory, stage],
            }
          : f,
      ),
    );
  };

  const markInlineFeedbackDone = (
    id?: string,
    frameName?: string,
    actionSummary?: string,
    workspaceId?: string,
    frameId?: string,
    outputAssets?: ImageAsset[],
  ) => {
    if (!id) return;
    setInlineFeedbacks((prev) =>
      prev.map((f) =>
        f.id === id
          ? {
              ...f,
              status: "done",
              frameName: frameName ?? f.frameName,
              actionSummary: actionSummary ?? f.actionSummary,
              workspaceId: workspaceId ?? f.workspaceId,
              frameId: frameId ?? f.frameId,
              outputAssets: outputAssets ?? f.outputAssets,
              selectedCount: outputAssets && outputAssets.length > 0 ? 1 : f.selectedCount,
              stageHistory: f.stageHistory.includes("done")
                ? f.stageHistory
                : [...f.stageHistory, "done"],
            }
          : f,
      ),
    );
  };

  const markInlineFeedbackError = (id?: string, message?: string) => {
    if (!id) return;
    setInlineFeedbacks((prev) =>
      prev.map((f) =>
        f.id === id
          ? {
              ...f,
              status: "error",
              errorMessage: message,
              stageHistory: f.stageHistory.includes("error")
                ? f.stageHistory
                : [...f.stageHistory, "error"],
            }
          : f,
      ),
    );
  };

  const toggleInlineFeedbackProcess = (id: string) => {
    setInlineFeedbacks((prev) =>
      prev.map((f) => (f.id === id ? { ...f, showProcess: !f.showProcess } : f)),
    );
  };

  useEffect(() => {
    const el = feedbackListRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [inlineFeedbacks.length]);

  const handleInlineFailFrame = (
    workspaceId: string,
    message: string,
    frameId?: string,
  ) => {
    if (!frameId) {
      window.alert(message);
      return;
    }
    setWorkspaces((prev) =>
      prev.map((ws) =>
        ws.id !== workspaceId
          ? ws
          : {
              ...ws,
              frames: ws.frames.map((f) =>
                f.id === frameId
                  ? { ...f, status: "error", errorMessage: message }
                  : f,
              ),
            },
      ),
    );
  };

  const deleteSelectedTarget = useCallback(() => {
    const hasAnySelection =
      selectedClipIds.length > 0 ||
      selectedFrameImages.length > 0 ||
      selectedFrameKeys.length > 0 ||
      Boolean(selectedFrame);
    if (!hasAnySelection) return;

    if (selectedClipIds.length > 0) {
      setClipAssets((prev) => prev.filter((c) => !selectedClipIds.includes(c.id)));
    }

    const stickyIds = selectedFrameImages
      .filter((id) => id.startsWith("sticky|note|"))
      .map((id) => id.split("|")[2]);
    if (stickyIds.length > 0) {
      setStickyNotes((prev) => prev.filter((note) => !stickyIds.includes(note.id)));
    }

    const assetKeys = selectedFrameImages.filter((id) => !id.startsWith("sticky|note|"));
    const frameKeysToDelete = Array.from(
      new Set([
        ...selectedFrameKeys,
        ...(selectedFrame ? [selectedFrame] : []),
      ]),
    );
    if (assetKeys.length > 0 || frameKeysToDelete.length > 0) {
      setWorkspaces((prev) =>
        prev
          .map((ws) => {
            let nextFrames = ws.frames.map((f) => {
              const keysToRemove = assetKeys.filter((k) => k.startsWith(`${ws.id}|${f.id}|`));
              if (keysToRemove.length === 0) return f;
              const assetIdsToRemove = keysToRemove.map((k) => k.split("|")[2]);
              return {
                ...f,
                assets: f.assets.filter((asset) => !assetIdsToRemove.includes(asset.id)),
              };
            });
            if (frameKeysToDelete.length > 0) {
              nextFrames = nextFrames.filter((f) => !frameKeysToDelete.includes(`${ws.id}|${f.id}`));
            }
            return {
              ...ws,
              frames: nextFrames.filter((f) => f.assets.length > 0),
            };
          })
          .filter((ws) => ws.frames.length > 0),
      );
    }

    assetKeys.forEach((key) => {
      delete assetRefs.current[key];
    });
    frameKeysToDelete.forEach((frameKey) => {
      Object.keys(assetRefs.current).forEach((k) => {
        if (k.startsWith(`${frameKey}|`)) delete assetRefs.current[k];
      });
      delete frameRefs.current[frameKey];
    });

    setSelectedFrameImages([]);
    setSelectedClipIds([]);
    setSelectedFrameKeys([]);
    setSelectedFrame(null);
    setSelectedWorkspace(null);
    setLineageSegments([]);
    setIsPathView(false);
  }, [selectedClipIds, selectedFrame, selectedFrameImages, selectedFrameKeys]);

  const activeFrameSelection = selectedFrameImages.length > 0
    ? selectedFrameImages[0].split("|").slice(0, 2).join("|")
    : selectedFrame;

  /** Image picked on canvas → preview in main chat box; switches when selection changes. */
  const mainChatAttachedImage = useMemo(() => {
    if (!selectedFrameImage) return null;
    const parts = selectedFrameImage.split("|");
    if (parts.length < 3) return null;
    const [workspaceId, frameId, assetId] = parts;
    const workspace = workspaces.find((ws) => ws.id === workspaceId);
    const frame = workspace?.frames.find((f) => f.id === frameId);
    const asset = frame?.assets.find((a) => a.id === assetId);
    if (!asset) return null;
    return { src: asset.src, alt: asset.alt };
  }, [selectedFrameImages, workspaces]);

  const lineageData = useMemo(() => {
    const empty = {
      frameKeys: [] as string[],
      imageKeys: [] as string[],
      workspaceIds: [] as string[],
      links: [] as Array<
        | { workspaceId: string; fromType: "frame"; fromKey: string; toFrameKey: string }
        | { workspaceId: string; fromType: "image"; fromKey: string; toFrameKey: string }
        | { workspaceId: string; fromType: "workspace"; fromKey: string; toFrameKey: string }
      >,
    };
    if (!activeFrameSelection) return empty;

    const [startWorkspaceId, startFrameId] = activeFrameSelection.split("|");
    let currentWorkspaceId = startWorkspaceId;
    let currentFrameId = startFrameId;
    const visited = new Set<string>();
    const frameSet = new Set<string>([`${startWorkspaceId}|${startFrameId}`]);
    const imageSet = new Set<string>();
    const workspaceSet = new Set<string>([startWorkspaceId]);
    const links: Array<
      | { workspaceId: string; fromType: "frame"; fromKey: string; toFrameKey: string }
      | { workspaceId: string; fromType: "image"; fromKey: string; toFrameKey: string }
      | { workspaceId: string; fromType: "workspace"; fromKey: string; toFrameKey: string }
    > = [];

    while (true) {
      const currentKey = `${currentWorkspaceId}|${currentFrameId}`;
      if (visited.has(currentKey)) break;
      visited.add(currentKey);

      const currentWorkspace = workspaces.find((ws) => ws.id === currentWorkspaceId);
      const currentFrame = currentWorkspace?.frames.find((f) => f.id === currentFrameId);
      const source = currentFrame?.sourceRef;
      if (!source) break;

      workspaceSet.add(source.workspaceId);
      if (source.level === "frame" && source.frameId) {
        const fromKey = `${source.workspaceId}|${source.frameId}`;
        frameSet.add(fromKey);
        links.unshift({
          workspaceId: source.workspaceId,
          fromType: "frame",
          fromKey,
          toFrameKey: currentKey,
        });
        currentWorkspaceId = source.workspaceId;
        currentFrameId = source.frameId;
        continue;
      }

      if (source.level === "image" && source.frameId && source.assetId) {
        const fromFrameKey = `${source.workspaceId}|${source.frameId}`;
        const fromImageKey = `${fromFrameKey}|${source.assetId}`;
        frameSet.add(fromFrameKey);
        imageSet.add(fromImageKey);
        links.unshift({
          workspaceId: source.workspaceId,
          fromType: "image",
          fromKey: fromImageKey,
          toFrameKey: currentKey,
        });
        currentWorkspaceId = source.workspaceId;
        currentFrameId = source.frameId;
        continue;
      }

      if (source.level === "workspace") {
        links.unshift({
          workspaceId: source.workspaceId,
          fromType: "workspace",
          fromKey: source.workspaceId,
          toFrameKey: currentKey,
        });
      }
      break;
    }

    return {
      frameKeys: Array.from(frameSet),
      imageKeys: Array.from(imageSet),
      workspaceIds: Array.from(workspaceSet),
      links,
    };
  }, [activeFrameSelection, workspaces]);

  useLayoutEffect(() => {
    if (!isPathView || lineageData.links.length === 0) {
      setLineageSegments([]);
      return;
    }
    const next: Array<{
      workspaceId: string;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
    }> = [];
    for (const link of lineageData.links) {
      const wsEl = workspaceRefs.current[link.workspaceId];
      const toEl = frameRefs.current[link.toFrameKey];
      if (!wsEl || !toEl) continue;
      let fromX = 0;
      let fromY = 0;
      if (link.fromType === "frame") {
        const fromEl = frameRefs.current[link.fromKey];
        if (!fromEl) continue;
        fromX = fromEl.offsetLeft + fromEl.offsetWidth / 2;
        fromY = fromEl.offsetTop + fromEl.offsetHeight / 2;
      } else if (link.fromType === "image") {
        const fromAssetEl = assetRefs.current[link.fromKey];
        if (!fromAssetEl) continue;
        const [sourceWorkspaceId, sourceFrameId] = link.fromKey.split("|");
        const sourceFrameEl = frameRefs.current[`${sourceWorkspaceId}|${sourceFrameId}`];
        if (!sourceFrameEl) continue;
        // Asset offsets are relative to its frame, so we need frame offsets too
        // to convert into workspace coordinates used by the SVG overlay.
        fromX =
          sourceFrameEl.offsetLeft + fromAssetEl.offsetLeft + fromAssetEl.offsetWidth / 2;
        fromY =
          sourceFrameEl.offsetTop + fromAssetEl.offsetTop + fromAssetEl.offsetHeight / 2;
      } else {
        fromX = wsEl.clientWidth / 2;
        fromY = 14;
      }
      next.push({
        workspaceId: link.workspaceId,
        fromX,
        fromY,
        toX: toEl.offsetLeft + toEl.offsetWidth / 2,
        toY: toEl.offsetTop + toEl.offsetHeight / 2,
      });
    }
    setLineageSegments(next);
  }, [isPathView, lineageData.links, workspaces]);

  const centerView = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const vw = el.clientWidth;
    const vh = el.clientHeight;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasWorkspaces = false;

    Object.values(workspaceRefs.current).forEach((wsEl) => {
      if (!wsEl) return;
      const left = wsEl.offsetLeft;
      const top = wsEl.offsetTop;
      const right = left + wsEl.offsetWidth;
      const bottom = top + wsEl.offsetHeight;

      minX = Math.min(minX, left);
      minY = Math.min(minY, top);
      maxX = Math.max(maxX, right);
      maxY = Math.max(maxY, bottom);
      hasWorkspaces = true;
    });

    if (hasWorkspaces) {
      const w = Math.max(maxX - minX, 1);
      const h = Math.max(maxY - minY, 1);
      
      const zoomX = vw / w;
      const zoomY = vh / h;
      // 0.26 means the workplace will take up about 26% of the viewport.
      const z = Math.min(zoomX, zoomY) * 0.26;
      
      const zz = clamp(z, ZOOM_MIN, ZOOM_MAX);
      
      const cx = minX + w / 2;
      const cy = minY + h / 2;
      
      setView({
        pan: { x: vw / 2 - cx * zz, y: vh / 2 - cy * zz },
        zoom: zz,
      });
    } else {
      const zz = clamp(DEFAULT_ZOOM, ZOOM_MIN, ZOOM_MAX);
      setView({
        pan: { x: vw / 2 - WORLD_CX * zz, y: vh / 2 - WORLD_CY * zz },
        zoom: zz,
      });
    }
  }, []);

  useLayoutEffect(() => {
    centerView();
  }, [centerView]);

  /** Pinch / Ctrl+wheel — one functional setView per tick so zoom never lags behind pan math */
  const applyPinchWheel = useCallback((clientX: number, clientY: number, deltaY: number) => {
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let mx = clientX - rect.left;
    let my = clientY - rect.top;
    if (mx < 0 || my < 0 || mx > rect.width || my > rect.height) {
      mx = rect.width / 2;
      my = rect.height / 2;
    }
    const delta = -deltaY * ZOOM_WHEEL_SENS;
    const factor = Math.exp(delta);
    setView((v) => zoomViewTowardPoint(v, mx, my, v.zoom * factor));
  }, []);

  /* Intercept Chrome/OS pinch-zoom (Ctrl/Cmd + wheel) before it scales the whole page */
  useEffect(() => {
    const onWinWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const t = e.target as HTMLElement;
      if (
        t.closest("[data-image-inline-chat]") ||
        t.closest("[data-prompt-framework]")
      ) {
        return;
      }
      e.preventDefault();
      applyPinchWheel(e.clientX, e.clientY, e.deltaY);
    };
    window.addEventListener("wheel", onWinWheel, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", onWinWheel, true);
  }, [applyPinchWheel]);

  const handleCreateAutoLayoutFrame = useCallback(() => {
    if (selectedClipIds.length > 0) {
      const selectedClips = clipAssets.filter((c) => selectedClipIds.includes(c.id));
      if (selectedClips.length === 0) return;
      const minX = Math.min(...selectedClips.map((c) => c.x));
      const minY = Math.min(...selectedClips.map((c) => c.y));
      const maxX = Math.max(...selectedClips.map((c) => c.x + c.width));
      const maxY = Math.max(...selectedClips.map((c) => c.y + c.height));
      const width = Math.max(1, Math.round(maxX - minX));
      const height = Math.max(1, Math.round(maxY - minY));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const drawPromises = selectedClips.map(
        (clip) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
              ctx.save();
              ctx.translate(clip.x - minX + clip.width / 2, clip.y - minY + clip.height / 2);
              ctx.rotate((clip.rotation * Math.PI) / 180);
              ctx.drawImage(img, -clip.width / 2, -clip.height / 2, clip.width, clip.height);
              ctx.restore();
              resolve();
            };
            img.onerror = () => resolve();
            img.src = clip.src;
          }),
      );
      Promise.all(drawPromises).then(() => {
        const mergedSrc = canvas.toDataURL("image/png");
        const newWorkspaceId = `ws-${Date.now()}`;
        const newFrameId = `f-${Date.now()}`;
        const standaloneCount = workspaces.filter((w) => w.isStandalone).length;
        const frameName = `Frame ${standaloneCount + 1}`;
        setWorkspaces((prev) => [
          ...prev,
          {
            id: newWorkspaceId,
            title: frameName,
            isStandalone: true,
            x: minX,
            y: maxY + 80,
            frames: [
              {
                id: newFrameId,
                name: frameName,
                status: "ready",
                assets: [{ id: `img-${Date.now()}`, src: mergedSrc, alt: "Merged clip source" }],
              },
            ],
          },
        ]);
        setSelectedClipIds([]);
      });
      return;
    }
    if (selectedFrameImages.length === 0) return;
    const selectedItems = selectedFrameImages.map((key) => {
      const [workspaceId, frameId, assetId] = key.split("|");
      const workspace = workspaces.find((w) => w.id === workspaceId);
      const frame = workspace?.frames.find((f) => f.id === frameId);
      const asset = frame?.assets.find((a) => a.id === assetId);
      return asset ? { oldKey: key, asset } : null;
    }).filter(Boolean) as Array<{ oldKey: string; asset: ImageAsset }>;

    if (selectedItems.length === 0) return;

    const newWorkspaceId = `ws-${Date.now()}`;
    const newFrameId = `f-${Date.now()}`;
    const standaloneCount = workspaces.filter(w => w.isStandalone).length;
    const frameName = `Frame ${standaloneCount + 1}`;

    let minX = Infinity, maxY = -Infinity;
    let foundAny = false;

    if (viewportRef.current) {
      const vRect = viewportRef.current.getBoundingClientRect();
      for (const key of selectedFrameImages) {
        const el = assetRefs.current[key];
        if (!el) continue;
        const aRect = el.getBoundingClientRect();
        
        // Convert screen coordinates to world coordinates
        const wx = (aRect.left - vRect.left - view.pan.x) / view.zoom;
        const wyBottom = (aRect.bottom - vRect.top - view.pan.y) / view.zoom;

        minX = Math.min(minX, wx);
        maxY = Math.max(maxY, wyBottom);
        foundAny = true;
      }
    }

    let dropX = WORLD_CX;
    let dropY = WORLD_CY;
    if (foundAny) {
      dropX = minX;
      dropY = maxY + 80; // place below the lowest selected item
    } else if (typeof window !== "undefined") {
      dropX = (window.innerWidth / 2 - view.pan.x) / view.zoom - 100;
      dropY = (window.innerHeight / 2 - view.pan.y) / view.zoom - 100;
    }

    const clonedAssets = selectedItems.map(({ asset }, i) => ({
      ...asset,
      id: `img-${Date.now()}-${i}`,
    }));

    setWorkspaces((prev) => [
      ...prev,
      {
        id: newWorkspaceId,
        title: frameName,
        isStandalone: true,
        x: dropX,
        y: dropY,
        frames: [
          {
            id: newFrameId,
            name: frameName,
            status: "ready",
            assets: clonedAssets,
          },
        ],
      },
    ]);
    setImageSizes((prev) => {
      const next = { ...prev };
      clonedAssets.forEach((asset, idx) => {
        const oldKey = selectedItems[idx]?.oldKey;
        if (!oldKey) return;
        const sourceSize = prev[oldKey];
        if (typeof sourceSize === "number") {
          next[`${newWorkspaceId}|${newFrameId}|${asset.id}`] = sourceSize;
        }
      });
      return next;
    });
    setSelectedFrameImages([]);
  }, [clipAssets, selectedClipIds, selectedFrameImages, workspaces, view]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        const isOnlyModifier =
          e.code === "MetaLeft" ||
          e.code === "MetaRight" ||
          e.code === "ControlLeft" ||
          e.code === "ControlRight";
        if (!isOnlyModifier) {
          setCommandDown(false);
          setCommandSelectLocked(true);
        } else if (!commandSelectLocked) {
          setCommandDown(true);
        }
      }
      const inField =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement;

      if (e.ctrlKey || e.metaKey) {
        if (!inField && e.code === "KeyA" && (selectedFrameImages.length > 0 || selectedClipIds.length > 0)) {
          e.preventDefault();
          handleCreateAutoLayoutFrame();
          return;
        }
        if (!inField && (e.code === "Equal" || e.code === "NumpadAdd")) {
          e.preventDefault();
          setView((v) =>
            applyZoomAtViewportCenter(
              v,
              v.zoom * ZOOM_STEP_RATIO,
              viewportRef.current,
            ),
          );
          return;
        }
        if (!inField && (e.code === "Minus" || e.code === "NumpadSubtract")) {
          e.preventDefault();
          setView((v) =>
            applyZoomAtViewportCenter(
              v,
              v.zoom / ZOOM_STEP_RATIO,
              viewportRef.current,
            ),
          );
          return;
        }
        if (!inField && e.code === "Digit0") {
          e.preventDefault();
          centerView();
          return;
        }
      }

      if (e.code === "Space" && !e.repeat) {
        if (inField) return;
        e.preventDefault();
        setSpaceDown(true);
      }

      if (
        !inField &&
        (selectedFrameImage || selectedFrame || selectedFrameKeys.length > 0 || selectedClipIds.length > 0) &&
        (e.key === "Backspace" || e.key === "Delete")
      ) {
        e.preventDefault();
        deleteSelectedTarget();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) {
        setCommandDown(false);
        setCommandSelectLocked(false);
      }
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("keyup", onKeyUp, { capture: true });
    };
  }, [centerView, commandSelectLocked, deleteSelectedTarget, selectedFrame, selectedFrameImages, selectedFrameKeys.length, selectedClipIds.length, handleCreateAutoLayoutFrame]);

  /** Two-finger / normal wheel pan: must use a non-passive native listener; React’s onWheel is passive. */
  const onViewportWheel = useCallback((e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) return;
    const t = e.target as HTMLElement;
    if (
      t.closest("[data-image-inline-chat]") ||
      t.closest("[data-prompt-framework]")
    ) {
      return;
    }
    e.preventDefault();
    setView((v) => ({
      ...v,
      pan: {
        x: v.pan.x - e.deltaX,
        y: v.pan.y - e.deltaY,
      },
    }));
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.addEventListener("wheel", onViewportWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onViewportWheel);
    };
  }, [onViewportWheel]);

  const updateSelectionFromMarquee = useCallback((box: { left: number; top: number; right: number; bottom: number }) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const intersects = (rect: DOMRect) =>
      rect.right >= box.left &&
      rect.left <= box.right &&
      rect.bottom >= box.top &&
      rect.top <= box.bottom;

    const imageKeys = Array.from(viewport.querySelectorAll<HTMLElement>("[data-image-key]"))
      .filter((el) => intersects(el.getBoundingClientRect()))
      .map((el) => el.dataset.imageKey)
      .filter((v): v is string => Boolean(v));
    const clipIds = Array.from(viewport.querySelectorAll<HTMLElement>("[data-clip-id]"))
      .filter((el) => intersects(el.getBoundingClientRect()))
      .map((el) => el.dataset.clipId)
      .filter((v): v is string => Boolean(v));
    const frameKeys = Array.from(viewport.querySelectorAll<HTMLElement>("[data-frame-key]"))
      .filter((el) => intersects(el.getBoundingClientRect()))
      .map((el) => el.dataset.frameKey)
      .filter((v): v is string => Boolean(v));

    setSelectedFrameImages(imageKeys);
    setSelectedClipIds(clipIds);
    setSelectedFrameKeys(frameKeys);
    setSelectedFrame(null);
    setSelectedWorkspace(null);
    setIsPathView(false);
  }, []);

  /** Canvas click (not on image / floating toolbar) clears selection; then space / middle-button pan */
  const onViewportPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const t = e.target as HTMLElement;
      const panWithSpace = spaceDown && e.button === 0;
      const panWithMiddle = e.button === 1;
      if (!panWithSpace && !panWithMiddle && e.button === 0) {
        const startedOnInteractive =
          Boolean(t.closest("[data-surface='frame']")) ||
          Boolean(t.closest("[data-image-slot]")) ||
          Boolean(t.closest("[data-canvas-clip]")) ||
          Boolean(t.closest("[data-floating-toolbar]")) ||
          Boolean(t.closest("[data-image-inline-chat]")) ||
          Boolean(t.closest("[data-prompt-framework]"));
        if (!startedOnInteractive) {
          const viewportRect = e.currentTarget.getBoundingClientRect();
          const localX = e.clientX - viewportRect.left;
          const localY = e.clientY - viewportRect.top;
          // Click blank canvas should clear immediately; drag continues into marquee selection.
          setPickingStyleTarget(null);
          setIsPathView(false);
          setMainShowImagePicker(false);
          setSelectedFrameImages([]);
          setSelectedClipIds([]);
          setSelectedFrameKeys([]);
          setSelectedFrame(null);
          setSelectedWorkspace(null);
          setMarqueeSelection({ startX: localX, startY: localY, endX: localX, endY: localY });
          setIsMarqueeSelecting(true);
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }
      }

      if (
        !t.closest("[data-surface='frame']") &&
        !t.closest("[data-surface='workplace']") &&
        !t.closest("[data-image-slot]") &&
        !t.closest("[data-canvas-clip]") &&
        !t.closest("[data-floating-toolbar]") &&
        !t.closest("[data-image-inline-chat]") &&
        !t.closest("[data-prompt-framework]")
      ) {
        setPickingStyleTarget(null);
        setIsPathView(false);
        setMainShowImagePicker(false);
        setSelectedFrameImages([]);
        setSelectedClipIds([]);
        setSelectedFrameKeys([]);
        setSelectedFrame(null);
        setSelectedWorkspace(null);
      }

      if (!panWithSpace && !panWithMiddle) return;
      e.preventDefault();
      setIsPanning(true);
      dragLastRef.current = { x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [spaceDown],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isMarqueeSelecting && marqueeSelection) {
        const viewportRect = e.currentTarget.getBoundingClientRect();
        const endX = e.clientX - viewportRect.left;
        const endY = e.clientY - viewportRect.top;
        setMarqueeSelection((prev) => (prev ? { ...prev, endX, endY } : prev));
        const movedX = Math.abs(endX - marqueeSelection.startX);
        const movedY = Math.abs(endY - marqueeSelection.startY);
        if (Math.max(movedX, movedY) < MARQUEE_DRAG_THRESHOLD_PX) return;
        updateSelectionFromMarquee({
          left: Math.min(marqueeSelection.startX, endX) + viewportRect.left,
          right: Math.max(marqueeSelection.startX, endX) + viewportRect.left,
          top: Math.min(marqueeSelection.startY, endY) + viewportRect.top,
          bottom: Math.max(marqueeSelection.startY, endY) + viewportRect.top,
        });
        return;
      }
      if (!isPanning) return;
      const dx = e.clientX - dragLastRef.current.x;
      const dy = e.clientY - dragLastRef.current.y;
      dragLastRef.current = { x: e.clientX, y: e.clientY };
      setView((v) => ({
        ...v,
        pan: { x: v.pan.x + dx, y: v.pan.y + dy },
      }));
    },
    [isMarqueeSelecting, isPanning, marqueeSelection, updateSelectionFromMarquee],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanning && !isMarqueeSelecting) return;
    if (isPanning) setIsPanning(false);
    if (isMarqueeSelecting) {
      setIsMarqueeSelecting(false);
      setMarqueeSelection(null);
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, [isMarqueeSelecting, isPanning]);

  const zoomPercentLabel = `${Math.round(view.zoom * 100)}%`;

  const startImageResize = useCallback(
    (
      e: React.PointerEvent<HTMLElement>,
      key: string,
      handle: ResizeHandle,
      currentSize: number,
    ) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const zoom = Math.max(view.zoom, 0.001);

      const onMove = (evt: PointerEvent) => {
        const dx = (evt.clientX - startX) / zoom;
        const dy = (evt.clientY - startY) / zoom;
        let delta = 0;
        if (handle === "se" || handle === "border") delta = Math.max(dx, dy);
        if (handle === "nw") delta = Math.max(-dx, -dy);
        if (handle === "ne") delta = Math.max(dx, -dy);
        if (handle === "sw") delta = Math.max(-dx, dy);
        const next = clamp(currentSize + delta, 72, 320);
        setImageSizes((prev) => ({ ...prev, [key]: next }));
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [view.zoom],
  );

  const startStickyResize = useCallback(
    (
      e: React.PointerEvent<HTMLElement>,
      noteId: string,
      handle: "nw" | "ne" | "sw" | "se",
      current: { x: number; y: number; width: number; height: number },
    ) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const zoom = Math.max(view.zoom, 0.001);
      const minW = 180;
      const minH = 180;
      const maxW = 520;
      const maxH = 520;

      const onMove = (evt: PointerEvent) => {
        const dx = (evt.clientX - startX) / zoom;
        const dy = (evt.clientY - startY) / zoom;

        let proposedW = current.width;
        let proposedH = current.height;
        if (handle === "se") {
          proposedW = current.width + dx;
          proposedH = current.height + dy;
        } else if (handle === "nw") {
          proposedW = current.width - dx;
          proposedH = current.height - dy;
        } else if (handle === "ne") {
          proposedW = current.width + dx;
          proposedH = current.height - dy;
        } else if (handle === "sw") {
          proposedW = current.width - dx;
          proposedH = current.height + dy;
        }

        const nextW = clamp(proposedW, minW, maxW);
        const nextH = clamp(proposedH, minH, maxH);
        const nextX =
          handle === "nw" || handle === "sw" ? current.x + (current.width - nextW) : current.x;
        const nextY =
          handle === "nw" || handle === "ne" ? current.y + (current.height - nextH) : current.y;

        setStickyNotes((prev) =>
          prev.map((n) =>
            n.id === noteId ? { ...n, x: nextX, y: nextY, width: nextW, height: nextH } : n,
          ),
        );
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [view.zoom],
  );

  const startStickyMove = useCallback(
    (e: React.PointerEvent<HTMLElement>, noteId: string) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const zoom = Math.max(view.zoom, 0.001);
      const note = stickyNotes.find((n) => n.id === noteId);
      if (!note) return;
      const origin = { x: note.x, y: note.y };
      const onMove = (evt: PointerEvent) => {
        const dx = (evt.clientX - startX) / zoom;
        const dy = (evt.clientY - startY) / zoom;
        setStickyNotes((prev) =>
          prev.map((n) => (n.id === noteId ? { ...n, x: origin.x + dx, y: origin.y + dy } : n)),
        );
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [stickyNotes, view.zoom],
  );

  const startClipMove = useCallback(
    (e: React.PointerEvent<HTMLElement>, clipId: string) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const zoom = Math.max(view.zoom, 0.001);
      const clip = clipAssets.find((c) => c.id === clipId);
      if (!clip) return;
      const origin = { x: clip.x, y: clip.y };
      const onMove = (evt: PointerEvent) => {
        const dx = (evt.clientX - startX) / zoom;
        const dy = (evt.clientY - startY) / zoom;
        setClipAssets((prev) =>
          prev.map((c) => (c.id === clipId ? { ...c, x: origin.x + dx, y: origin.y + dy } : c)),
        );
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [clipAssets, view.zoom],
  );

  const startClipResize = useCallback(
    (
      e: React.PointerEvent<HTMLElement>,
      clipId: string,
      handle: "nw" | "ne" | "sw" | "se",
      current: ClipAsset,
    ) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const zoom = Math.max(view.zoom, 0.001);
      const onMove = (evt: PointerEvent) => {
        const dx = (evt.clientX - startX) / zoom;
        const dy = (evt.clientY - startY) / zoom;
        const aspect = current.width / Math.max(current.height, 1);
        let delta = 0;
        if (handle === "se") delta = Math.max(dx, dy);
        if (handle === "nw") delta = Math.max(-dx, -dy);
        if (handle === "ne") delta = Math.max(dx, -dy);
        if (handle === "sw") delta = Math.max(-dx, dy);
        let nextW = clamp(current.width + delta, 48, 480);
        let nextH = nextW / Math.max(aspect, 0.001);
        if (nextH > 480) {
          nextH = 480;
          nextW = nextH * aspect;
        }
        if (nextH < 48) {
          nextH = 48;
          nextW = nextH * aspect;
        }
        const nextX = handle === "nw" || handle === "sw" ? current.x + (current.width - nextW) : current.x;
        const nextY = handle === "nw" || handle === "ne" ? current.y + (current.height - nextH) : current.y;
        setClipAssets((prev) =>
          prev.map((c) =>
            c.id === clipId ? { ...c, x: nextX, y: nextY, width: nextW, height: nextH } : c,
          ),
        );
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [view.zoom],
  );

  const startClipRotate = useCallback(
    (e: React.PointerEvent<HTMLElement>, clipId: string, current: ClipAsset) => {
      e.preventDefault();
      e.stopPropagation();
      const center = { x: current.x + current.width / 2, y: current.y + current.height / 2 };
      const viewportRect = viewportRef.current?.getBoundingClientRect();
      if (!viewportRect) return;
      const onMove = (evt: PointerEvent) => {
        const wx = (evt.clientX - viewportRect.left - view.pan.x) / Math.max(view.zoom, 0.001);
        const wy = (evt.clientY - viewportRect.top - view.pan.y) / Math.max(view.zoom, 0.001);
        const deg = (Math.atan2(wy - center.y, wx - center.x) * 180) / Math.PI + 90;
        setClipAssets((prev) => prev.map((c) => (c.id === clipId ? { ...c, rotation: deg } : c)));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [view.pan.x, view.pan.y, view.zoom],
  );

  const startFrameMove = useCallback(
    (e: React.PointerEvent<HTMLElement>, frameKey: string) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const zoom = Math.max(view.zoom, 0.001);
      const origin = frameOffsets[frameKey] ?? { x: 0, y: 0 };
      setDraggingFrameKey(frameKey);

      const onMove = (evt: PointerEvent) => {
        const dx = (evt.clientX - startX) / zoom;
        const dy = (evt.clientY - startY) / zoom;
        setFrameOffsets((prev) => ({ ...prev, [frameKey]: { x: origin.x + dx, y: origin.y + dy } }));
      };

      const onUp = () => {
        setDraggingFrameKey((prev) => (prev === frameKey ? null : prev));
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [frameOffsets, view.zoom],
  );

  const findOpenCanvasSpot = useCallback(
    (width: number, height: number) => {
      const viewport = viewportRef.current;
      const zoom = Math.max(view.zoom, 0.001);
      const fallbackX = WORLD_CX;
      const fallbackY = WORLD_CY;
      if (!viewport) return { x: fallbackX, y: fallbackY };

      const startX = (viewport.clientWidth / 2 - view.pan.x) / zoom;
      const startY = (viewport.clientHeight / 2 - view.pan.y) / zoom;

      const occupied: Array<{ x: number; y: number; w: number; h: number }> = [];
      stickyNotes.forEach((n) => occupied.push({ x: n.x, y: n.y, w: n.width, h: n.height }));
      clipAssets.forEach((c) => occupied.push({ x: c.x, y: c.y, w: c.width, h: c.height }));
      Object.values(workspaceRefs.current).forEach((el) => {
        if (!el) return;
        occupied.push({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
      });

      const intersects = (ax: number, ay: number, aw: number, ah: number) =>
        occupied.some((b) => ax < b.x + b.w && ax + aw > b.x && ay < b.y + b.h && ay + ah > b.y);

      const gap = 48;
      const step = 36;
      const maxRadius = 40;
      const baseX = startX - width / 2;
      const baseY = startY - height / 2;

      for (let r = 0; r <= maxRadius; r += 1) {
        const radius = r * step;
        for (let i = 0; i < 16; i += 1) {
          const theta = (Math.PI * 2 * i) / 16;
          const x = baseX + Math.cos(theta) * radius;
          const y = baseY + Math.sin(theta) * radius;
          if (!intersects(x - gap, y - gap, width + gap * 2, height + gap * 2)) {
            return { x, y };
          }
        }
      }
      return { x: baseX, y: baseY };
    },
    [clipAssets, stickyNotes, view.pan.x, view.pan.y, view.zoom],
  );

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#efefef] font-sans text-neutral-800">
      {pickingStyleTarget !== null && (
        <div className="pointer-events-auto fixed top-6 left-1/2 z-[9999] flex -translate-x-1/2 items-center gap-3 rounded-full bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white shadow-xl">
          <MousePointer2 size={16} className="text-neutral-400" />
          <span>Select an image on the canvas</span>
          <button
            type="button"
            onClick={() => {
              setPickingStyleTarget(null);
              setIsPathView(false);
              setMainShowImagePicker(false);
              setSelectedFrameImages([]);
              setSelectedFrame(null);
              setSelectedWorkspace(null);
            }}
            className="ml-2 rounded-full bg-white/20 p-1 hover:bg-white/30 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {/* Canvas-only viewport: pan/zoom transform applies ONLY here; chrome & chat stay fixed */}
      <div
        ref={viewportRef}
        className="absolute top-0 bottom-0 left-0 z-0 touch-none overflow-hidden overscroll-none select-none"
        style={{
          right: 0,
          cursor:
            isPanning ? "grabbing" : spaceDown ? "grab" : "default",
        }}
        onPointerDown={onViewportPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={(e) => {
          if (isPanning || isMarqueeSelecting) onPointerUp(e);
        }}
      >
        {marqueeSelection ? (
          <div className="pointer-events-none absolute inset-0 z-[120]">
            <div
              className="absolute border border-neutral-700/70 bg-neutral-300/20"
              style={{
                left: Math.min(marqueeSelection.startX, marqueeSelection.endX),
                top: Math.min(marqueeSelection.startY, marqueeSelection.endY),
                width: Math.abs(marqueeSelection.endX - marqueeSelection.startX),
                height: Math.abs(marqueeSelection.endY - marqueeSelection.startY),
              }}
            />
          </div>
        ) : null}
        <div
          className="relative will-change-transform"
          style={{
            width: WORLD_W,
            height: WORLD_H,
            transform: `translate(${view.pan.x}px, ${view.pan.y}px) scale(${view.zoom})`,
            transformOrigin: "0 0",
          }}
        >
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: "radial-gradient(#b7bec7 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          />
          {clipAssets.map((clip) => {
            const selected = selectedClipIds.includes(clip.id);
            return (
              <div
                key={clip.id}
                data-canvas-clip
                data-clip-id={clip.id}
                className={`pointer-events-auto absolute ${selected ? "ring-2 ring-black" : ""}`}
                style={{
                  left: clip.x,
                  top: clip.y,
                  width: clip.width,
                  height: clip.height,
                  transform: `rotate(${clip.rotation}deg)`,
                  transformOrigin: "center center",
                }}
                onPointerDown={(e) => {
                  if (e.metaKey && commandDown) {
                    setSelectedClipIds((prev) =>
                      prev.includes(clip.id) ? prev.filter((id) => id !== clip.id) : [...prev, clip.id],
                    );
                  } else {
                    setSelectedClipIds([clip.id]);
                  }
                  setSelectedFrameKeys([]);
                  setSelectedFrameImages([]);
                  setSelectedFrame(null);
                  setSelectedWorkspace(null);
                  startClipMove(e, clip.id);
                }}
              >
                <img src={clip.src} alt="Clipped region" className="h-full w-full object-cover" draggable={false} />
                {selected ? (
                  <>
                    <button type="button" className="absolute -left-1 -top-1 z-20 h-2.5 w-2.5 cursor-nwse-resize rounded-sm border border-black bg-white" onPointerDown={(e) => startClipResize(e, clip.id, "nw", clip)} />
                    <button type="button" className="absolute -right-1 -top-1 z-20 h-2.5 w-2.5 cursor-nesw-resize rounded-sm border border-black bg-white" onPointerDown={(e) => startClipResize(e, clip.id, "ne", clip)} />
                    <button type="button" className="absolute -bottom-1 -left-1 z-20 h-2.5 w-2.5 cursor-nesw-resize rounded-sm border border-black bg-white" onPointerDown={(e) => startClipResize(e, clip.id, "sw", clip)} />
                    <button type="button" className="absolute -bottom-1 -right-1 z-20 h-2.5 w-2.5 cursor-nwse-resize rounded-sm border border-black bg-white" onPointerDown={(e) => startClipResize(e, clip.id, "se", clip)} />
                    <button type="button" className="absolute left-1/2 -top-6 z-20 h-3 w-3 -translate-x-1/2 cursor-grab rounded-full border border-black bg-white" onPointerDown={(e) => startClipRotate(e, clip.id, clip)} />
                  </>
                ) : null}
              </div>
            );
          })}
          {stickyNotes.map((note) => {
            const stickyKey = `sticky|note|${note.id}`;
            const selected = selectedFrameImages.includes(stickyKey);
            const hovered = hoveredFrameImage === stickyKey;
            return (
              <div
                key={note.id}
                data-image-slot
                data-image-key={stickyKey}
                className={`pointer-events-auto absolute ${
                  selected
                    ? "rounded-none ring-2 ring-black"
                    : hovered
                      ? "rounded-xl ring-2 ring-black"
                      : "rounded-xl"
                }`}
                style={{
                  left: note.x,
                  top: note.y,
                  width: note.width,
                  height: note.height,
                }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Sticky note on canvas"
                  className={`relative flex h-full w-full cursor-pointer flex-col gap-3 bg-[#f2a3cf] px-5 py-5 text-neutral-800 shadow-md ${
                    selected ? "rounded-none" : "rounded-xl"
                  }`}
                  style={{
                    backgroundImage:
                      "linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.04))",
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (
                      document.activeElement instanceof HTMLInputElement ||
                      document.activeElement instanceof HTMLTextAreaElement
                    ) {
                      document.activeElement.blur();
                    }
                    setSelectedFrameImages([stickyKey]);
                    setSelectedClipIds([]);
                    setSelectedFrameKeys([]);
                    setSelectedFrame(null);
                    setHoveredFrame(null);
                    setHoveredFrameImage(null);
                    setSelectedWorkspace(null);
                    setIsPathView(false);
                    startStickyMove(e, note.id);
                  }}
                  onPointerEnter={() => {
                    setHoveredFrameImage(stickyKey);
                    setHoveredFrame(null);
                  }}
                  onPointerLeave={() => {
                    if (hoveredFrameImage === stickyKey) {
                      setHoveredFrameImage(null);
                    }
                  }}
                >
                  <p className="font-[cursive] text-[22px] font-bold leading-tight">{note.title} 💗</p>
                  <p className="whitespace-pre-line text-[14px] font-medium leading-relaxed">
                    {note.message}
                  </p>
                  <p className="font-[cursive] text-[17px] leading-tight">{note.footer}</p>
                </div>
                {selected ? (
                  <>
                    <button
                      type="button"
                      aria-label="Resize sticky note from top-left"
                      className="absolute -left-1 -top-1 z-20 h-2.5 w-2.5 cursor-nwse-resize rounded-sm border border-black bg-white shadow-sm"
                      onPointerDown={(e) => startStickyResize(e, note.id, "nw", note)}
                    />
                    <button
                      type="button"
                      aria-label="Resize sticky note from top-right"
                      className="absolute -right-1 -top-1 z-20 h-2.5 w-2.5 cursor-nesw-resize rounded-sm border border-black bg-white shadow-sm"
                      onPointerDown={(e) => startStickyResize(e, note.id, "ne", note)}
                    />
                    <button
                      type="button"
                      aria-label="Resize sticky note from bottom-left"
                      className="absolute -bottom-1 -left-1 z-20 h-2.5 w-2.5 cursor-nesw-resize rounded-sm border border-black bg-white shadow-sm"
                      onPointerDown={(e) => startStickyResize(e, note.id, "sw", note)}
                    />
                    <button
                      type="button"
                      aria-label="Resize sticky note from bottom-right"
                      className="absolute -bottom-1 -right-1 z-20 h-2.5 w-2.5 cursor-nwse-resize rounded-sm border border-black bg-white shadow-sm"
                      onPointerDown={(e) => startStickyResize(e, note.id, "se", note)}
                    />
                  </>
                ) : null}
              </div>
            );
          })}
          <div className="pointer-events-auto flex h-full w-full items-center justify-center gap-10 px-8 flex-wrap content-center">
            {workspaces.map((workspace) => (
              <div
                key={workspace.id}
                ref={(el) => {
                  workspaceRefs.current[workspace.id] = el;
                }}
                data-surface="workplace"
                onPointerDown={(e) => {
                  const el = e.target as HTMLElement;
                  if (
                    el.closest("[data-surface='frame']") ||
                    el.closest("[data-image-slot]") ||
                    el.closest("[data-floating-toolbar]") ||
                    el.closest("[data-image-inline-chat]") ||
                    el.closest("[data-prompt-framework]")
                  ) {
                    return;
                  }
                  setSelectedFrameImages([]);
                  setSelectedClipIds([]);
                  setSelectedFrameKeys([]);
                  setSelectedFrame(null);
                  setSelectedWorkspace(null);
                  setIsPathView(false);
                }}
                onPointerMove={(e) => {
                  const el = e.target as HTMLElement;
                  if (
                    el.closest("[data-surface='frame']") ||
                    el.closest("[data-image-slot]") ||
                    el.closest("[data-floating-toolbar]") ||
                    el.closest("[data-image-inline-chat]") ||
                    el.closest("[data-prompt-framework]")
                  ) {
                    if (hoveredWorkspace === workspace.id) setHoveredWorkspace(null);
                    return;
                  }
                  if (hoveredWorkspace !== workspace.id) setHoveredWorkspace(workspace.id);
                }}
                onPointerLeave={() => {
                  if (hoveredWorkspace === workspace.id) setHoveredWorkspace(null);
                }}
                className={`${workspace.isStandalone ? "absolute" : "relative"} flex min-w-0 max-w-full flex-col items-start transition-all ${
                  workspace.isStandalone
                    ? ""
                    : `gap-3 rounded-3xl border-2 ${
                        hoveredWorkspace === workspace.id ? "border-solid" : "border-dashed"
                      } p-3 ${
                        hoveredWorkspace === workspace.id
                          ? "border-neutral-700 bg-white/25"
                          : ""
                      } ${
                        isPathView && activeFrameSelection
                          ? lineageData.workspaceIds.includes(workspace.id)
                            ? "border-neutral-400/80"
                            : "border-neutral-300/80 opacity-15 saturate-0"
                          : "border-neutral-400/80"
                      }`
                }`}
                style={
                  workspace.isStandalone
                    ? { left: workspace.x, top: workspace.y }
                    : undefined
                }
              >
                {isPathView && lineageSegments.some((seg) => seg.workspaceId === workspace.id) ? (
                  <svg className="pointer-events-none absolute inset-0 z-[95] overflow-visible">
                    <defs>
                      <marker
                        id={`lineage-arrow-${workspace.id}`}
                        markerWidth="8"
                        markerHeight="8"
                        refX="7"
                        refY="4"
                        orient="auto"
                        markerUnits="strokeWidth"
                      >
                        <path d="M0,0 L8,4 L0,8 Z" fill="rgba(17, 24, 39, 0.9)" />
                      </marker>
                    </defs>
                    {lineageSegments
                      .filter((seg) => seg.workspaceId === workspace.id)
                      .map((seg, idx) => {
                        const midY = (seg.fromY + seg.toY) / 2;
                        const d = `M ${seg.fromX} ${seg.fromY} C ${seg.fromX} ${midY}, ${seg.toX} ${midY}, ${seg.toX} ${seg.toY}`;
                        return (
                          <g key={`${seg.workspaceId}-${idx}`}>
                            <path
                              d={d}
                              fill="none"
                              stroke="rgba(55, 65, 81, 0.6)"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeDasharray="4 4"
                              markerEnd={`url(#lineage-arrow-${workspace.id})`}
                            />
                          </g>
                        );
                      })}
                  </svg>
                ) : null}
                {workspace.frames
                  .filter((frame) => frame.status !== "ready" || frame.assets.length > 0)
                  .map((frame) => {
                    return (
                  <div
                    key={frame.id}
                    data-surface="frame"
                    data-frame-key={`${workspace.id}|${frame.id}`}
                    onContextMenu={(e) => {
                      if (selectedFrameImages.length > 0) return; // let image right click handle it
                      e.preventDefault();
                      setFrameContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        workspaceId: workspace.id,
                        frameId: frame.id,
                      });
                    }}
                    ref={(el) => {
                      frameRefs.current[`${workspace.id}|${frame.id}`] = el;
                    }}
                    className={`relative w-fit rounded-2xl bg-white p-2 ${
                      draggingFrameKey === `${workspace.id}|${frame.id}` ? "" : "transition-all"
                    } ${
                      selectedFrame === `${workspace.id}|${frame.id}`
                      || selectedFrameKeys.includes(`${workspace.id}|${frame.id}`)
                        ? "rounded-none ring-2 ring-black"
                        : hoveredFrame === `${workspace.id}|${frame.id}`
                          ? "ring-2 ring-black"
                          : ""
                    } ${
                      isPathView && activeFrameSelection
                        ? lineageData.frameKeys.includes(`${workspace.id}|${frame.id}`)
                          ? "opacity-100 saturate-100"
                          : "opacity-10 saturate-0"
                        : ""
                    }`}
                    style={{
                      transform: `translate(${frameOffsets[`${workspace.id}|${frame.id}`]?.x ?? 0}px, ${frameOffsets[`${workspace.id}|${frame.id}`]?.y ?? 0}px)`,
                      cursor: "default",
                    }}
                    onPointerDown={(e) => {
                      const el = e.target as HTMLElement;
                      if (
                        el.closest("[data-floating-toolbar]") ||
                        el.closest("[data-image-slot]") ||
                        el.closest("[data-image-inline-chat]") ||
                        el.closest("[data-prompt-framework]")
                      ) {
                        return;
                      }
                      setSelectedFrameImages([]);
                      setSelectedClipIds([]);
                      setSelectedFrameKeys([]);
                      setSelectedFrame(`${workspace.id}|${frame.id}`);
                      setSelectedWorkspace(null);
                      startFrameMove(e, `${workspace.id}|${frame.id}`);
                    }}
                    onPointerMove={(e) => {
                      const el = e.target as HTMLElement;
                      if (
                        el.closest("[data-image-slot]") ||
                        el.closest("[data-floating-toolbar]") ||
                        el.closest("[data-image-inline-chat]") ||
                        el.closest("[data-prompt-framework]")
                      ) {
                        if (hoveredFrame === `${workspace.id}|${frame.id}`) {
                          setHoveredFrame(null);
                        }
                        return;
                      }
                      if (hoveredFrame !== `${workspace.id}|${frame.id}`) {
                        setHoveredFrame(`${workspace.id}|${frame.id}`);
                      }
                    }}
                    onPointerLeave={() => {
                      if (hoveredFrame === `${workspace.id}|${frame.id}`) {
                        setHoveredFrame(null);
                      }
                    }}
                  >
                    {selectedFrame === `${workspace.id}|${frame.id}` ? (
                      <>
                        <span
                          className="pointer-events-none absolute -left-1 -top-1 z-10 h-2.5 w-2.5 rounded-sm border border-black bg-white shadow-sm"
                          aria-hidden
                        />
                        <span
                          className="pointer-events-none absolute -right-1 -top-1 z-10 h-2.5 w-2.5 rounded-sm border border-black bg-white shadow-sm"
                          aria-hidden
                        />
                        <span
                          className="pointer-events-none absolute -bottom-1 -left-1 z-10 h-2.5 w-2.5 rounded-sm border border-black bg-white shadow-sm"
                          aria-hidden
                        />
                        <span
                          className="pointer-events-none absolute -bottom-1 -right-1 z-10 h-2.5 w-2.5 rounded-sm border border-black bg-white shadow-sm"
                          aria-hidden
                        />
                      </>
                    ) : null}
                    {frame.name ? (
                      <div
                        className="absolute bottom-full left-0 z-[250] mb-0.5 origin-bottom-left"
                        style={{
                          transform: `scale(${1 / Math.max(view.zoom, 0.001)})`,
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <div
                          className="flex h-6 max-w-[260px] items-center gap-1.5 overflow-hidden px-0.5 text-[13px] font-medium leading-none text-neutral-600 hover:text-neutral-800"
                        >
                          {frame.boardType ? (
                            <span
                              className={`rounded-md px-2 py-1 text-xs font-semibold ${
                                frame.boardType === "reference"
                                  ? "bg-emerald-600 text-white"
                                  : "bg-violet-600 text-white"
                              }`}
                            >
                              {frame.boardType === "reference" ? "Reference" : "Mood"}
                            </span>
                          ) : null}
                          {editingFrameId === `${workspace.id}|${frame.id}` ? (
                            <input
                              // eslint-disable-next-line jsx-a11y/no-autofocus
                              autoFocus
                              defaultValue={frame.name}
                              className="h-6 min-w-0 max-w-[220px] bg-transparent px-0.5 text-[13px] font-medium leading-none text-neutral-800 outline-none"
                              onBlur={(e) => {
                                const newName = e.target.value.trim() || "Untitled";
                                setWorkspaces((prev) =>
                                  prev.map((ws) =>
                                    ws.id === workspace.id
                                      ? {
                                          ...ws,
                                          frames: ws.frames.map((f) =>
                                            f.id === frame.id ? { ...f, name: newName } : f
                                          ),
                                        }
                                      : ws
                                  )
                                );
                                setEditingFrameId(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.currentTarget.blur();
                                }
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              className="h-6 min-w-0 truncate text-left leading-6 cursor-text"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingFrameId(`${workspace.id}|${frame.id}`);
                              }}
                            >
                              {frame.name}
                            </button>
                          )}
                        </div>
                      </div>
                    ) : null}
                    {frame.status !== "ready" ? (
                      <div className="relative">
                        <div className="pointer-events-none absolute bottom-full left-0 z-[250] mb-6">
                          <GenerationTitlePill
                            prompt={frame.prompt ?? workspace.title}
                            canvasZoom={view.zoom}
                          />
                        </div>
                        <GenerationFeedbackFrame
                          isGenerating={frame.status === "generating"}
                          errorMessage={frame.errorMessage}
                        />
                      </div>
                    ) : (
                      <div className="flex flex-row flex-wrap items-start justify-center gap-1.5 sm:gap-2">
                        {frame.assets.map((asset) => {
                        const key = `${workspace.id}|${frame.id}|${asset.id}`;
                        const size = imageSizes[key] ?? 144;
                        const ratio = imageAspectRatios[key] ?? 1;
                        // Use short-edge as baseline so width/height can expand with aspect ratio.
                        const displayWidth = ratio >= 1 ? size * ratio : size;
                        const displayHeight = ratio >= 1 ? size : size / ratio;
                        const selected = selectedFrameImages.includes(key);
                        const hovered = hoveredFrameImage === key;
                        const isLineageSourceImage =
                          isPathView && lineageData.imageKeys.includes(key);
                        return (
                          <div
                            key={asset.id}
                            data-image-slot
                            data-image-key={key}
                            ref={(el) => {
                              assetRefs.current[key] = el;
                            }}
                            className={`relative shrink-0 ${
                              selected
                                ? "rounded-none ring-2 ring-black"
                                : hovered
                                  ? "rounded-xl ring-2 ring-black"
                                : isLineageSourceImage
                                  ? "rounded-xl ring-2 ring-black"
                                  : "rounded-xl"
                            }`}
                          >
                            <img
                              src={asset.src}
                              alt={asset.alt}
                              style={{ width: displayWidth, height: displayHeight }}
                              className={`block cursor-pointer object-cover ${selected ? "rounded-none" : "rounded-xl"}`}
                              onLoad={(e) => {
                                const target = e.currentTarget;
                                if (!target.naturalWidth || !target.naturalHeight) return;
                                const nextRatio = target.naturalWidth / target.naturalHeight;
                                if (!Number.isFinite(nextRatio) || nextRatio <= 0) return;
                                setImageAspectRatios((prev) =>
                                  prev[key] === nextRatio ? prev : { ...prev, [key]: nextRatio },
                                );
                              }}
                              onContextMenu={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                setFrameContextMenu({
                                  x: e.clientX,
                                  y: e.clientY,
                                  workspaceId: workspace.id,
                                  frameId: frame.id,
                                });
                              }}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                if (pickingStyleTarget !== null) {
                                  window.dispatchEvent(new CustomEvent("style-picked", { detail: asset.src }));
                                  setPickingStyleTarget(null);
                                  return;
                                }
                                if (
                                  document.activeElement instanceof HTMLInputElement ||
                                  document.activeElement instanceof HTMLTextAreaElement
                                ) {
                                  document.activeElement.blur();
                                }
                                if (e.metaKey && commandDown) {
                                  setSelectedFrameImages((prev) =>
                                    prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
                                  );
                                } else {
                                  setSelectedFrameImages([key]);
                                }
                                setSelectedClipIds([]);
                                setSelectedFrameKeys([]);
                                setSelectedFrame(null);
                                setHoveredFrame(null);
                                setHoveredFrameImage(null);
                                setSelectedWorkspace(null);
                                setIsPathView(false);
                              }}
                              onPointerEnter={() => {
                                setHoveredFrameImage(key);
                                setHoveredFrame(null);
                              }}
                              onPointerLeave={() => {
                                if (hoveredFrameImage === key) {
                                  setHoveredFrameImage(null);
                                }
                              }}
                            />
                            {selected ? (
                              <>
                                <button
                                  type="button"
                                  aria-label="Resize from top-left"
                                  className="absolute -left-1 -top-1 z-20 h-2.5 w-2.5 cursor-nwse-resize rounded-sm border border-black bg-white shadow-sm"
                                  onPointerDown={(e) => startImageResize(e, key, "nw", size)}
                                />
                                <button
                                  type="button"
                                  aria-label="Resize from top-right"
                                  className="absolute -right-1 -top-1 z-20 h-2.5 w-2.5 cursor-nesw-resize rounded-sm border border-black bg-white shadow-sm"
                                  onPointerDown={(e) => startImageResize(e, key, "ne", size)}
                                />
                                <button
                                  type="button"
                                  aria-label="Resize from bottom-left"
                                  className="absolute -bottom-1 -left-1 z-20 h-2.5 w-2.5 cursor-nesw-resize rounded-sm border border-black bg-white shadow-sm"
                                  onPointerDown={(e) => startImageResize(e, key, "sw", size)}
                                />
                                <button
                                  type="button"
                                  aria-label="Resize from bottom-right"
                                  className="absolute -bottom-1 -right-1 z-20 h-2.5 w-2.5 cursor-nwse-resize rounded-sm border border-black bg-white shadow-sm"
                                  onPointerDown={(e) => startImageResize(e, key, "se", size)}
                                />
                                {selectedFrameImages.length === 1 ? (
                                  <>
                                    <ImageEditToolbar
                                      canvasZoom={view.zoom}
                                      isPathView={isPathView}
                                      onOpenClip={() => {
                                        setClipDraft({ src: asset.src, imageKey: key });
                                        setClipPathPoints([]);
                                        setIsClipDrawing(false);
                                      }}
                                      onTogglePathView={() => {
                                        setSelectedFrameImages([key]);
                                        setSelectedFrame(null);
                                        setSelectedWorkspace(null);
                                        setIsPathView((v) => {
                                          const next = !v;
                                          if (!next) {
                                            setSelectedFrameImages([]);
                                            setSelectedFrame(null);
                                            setSelectedWorkspace(null);
                                          }
                                          return next;
                                        });
                                      }}
                                    />
                                    <ImageInlineChat
                                      canvasZoom={view.zoom}
                                      sourceAssets={[asset]}
                                      allAssets={allAssets}
                                      isPickingStyle={pickingStyleTarget === "inline"}
                                      onStartPickingStyle={() => setPickingStyleTarget("inline")}
                                      onStopPickingStyle={() => setPickingStyleTarget(null)}
                                      onStart={(prompt, meta) => {
                                        const pendingId = handleInlineStartFrame(workspace.id, prompt, {
                                          level: "image",
                                          workspaceId: workspace.id,
                                          frameId: frame.id,
                                          assetId: asset.id,
                                        });
                                        pushInlineFeedback(
                                          pendingId,
                                          prompt,
                                          "image",
                                          1,
                                          meta?.inputAsset ?? asset,
                                          meta?.styleRefSrc,
                                          meta?.frameworkId,
                                          meta?.ratioWidth,
                                          meta?.ratioHeight,
                                          meta?.promptFrameLines,
                                          meta?.userPromptInput,
                                        );
                                        // Hide local inline controls immediately after submit.
                                        setSelectedFrameImages([]);
                                        setSelectedFrame(null);
                                        setHoveredFrameImage(null);
                                        return pendingId;
                                      }}
                                      onSuccess={(prompt, assets, frameName, frameId, actionSummary) => {
                                        handleInlineAddFrame(
                                          workspace.id,
                                          assets,
                                          frameName,
                                          frameId,
                                        );
                                        markInlineFeedbackDone(
                                          frameId,
                                          frameName,
                                          actionSummary,
                                          workspace.id,
                                          frameId,
                                          assets,
                                        );
                                      }}
                                      onStageChange={(frameId, stage) =>
                                        markInlineFeedbackStage(frameId, stage)
                                      }
                                      onError={(m, frameId) =>
                                      {
                                        handleInlineFailFrame(workspace.id, m, frameId);
                                        markInlineFeedbackError(frameId, m);
                                      }
                                      }
                                    />
                                  </>
                                ) : null}
                              </>
                            ) : null}
                          </div>
                        );
                        })}
                      </div>
                    )}
                    {selectedFrame === `${workspace.id}|${frame.id}` &&
                    selectedFrameImages.length === 0 &&
                    frame.status === "ready" ? (
                      <ImageInlineChat
                        canvasZoom={view.zoom}
                        sourceAssets={frame.assets}
                        allAssets={allAssets}
                        isPickingStyle={pickingStyleTarget === "inline"}
                        onStartPickingStyle={() => setPickingStyleTarget("inline")}
                        onStopPickingStyle={() => setPickingStyleTarget(null)}
                        onStart={(prompt, meta) => {
                          const pendingId = handleInlineStartFrame(workspace.id, prompt, {
                            level: "frame",
                            workspaceId: workspace.id,
                            frameId: frame.id,
                          });
                          pushInlineFeedback(
                            pendingId,
                            prompt,
                            "frame",
                            Math.max(1, frame.assets.length),
                            meta?.inputAsset ?? frame.assets[0],
                            meta?.styleRefSrc,
                            meta?.frameworkId,
                            meta?.ratioWidth,
                            meta?.ratioHeight,
                            meta?.promptFrameLines,
                            meta?.userPromptInput,
                          );
                          setSelectedFrame(null);
                          setHoveredFrame(null);
                          return pendingId;
                        }}
                        onSuccess={(prompt, assets, frameName, frameId, actionSummary) => {
                          handleInlineAddFrame(
                            workspace.id,
                            assets,
                            frameName,
                            frameId,
                          );
                          markInlineFeedbackDone(
                            frameId,
                            frameName,
                            actionSummary,
                            workspace.id,
                            frameId,
                            assets,
                          );
                        }}
                        onStageChange={(frameId, stage) =>
                          markInlineFeedbackStage(frameId, stage)
                        }
                        onError={(m, frameId) => {
                          handleInlineFailFrame(workspace.id, m, frameId);
                          markInlineFeedbackError(frameId, m);
                        }}
                      />
                    ) : null}
                  </div>
                    );
                  })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {isPathView && activeFrameSelection ? (
        <div className="pointer-events-auto fixed top-6 left-1/2 z-[9999] flex -translate-x-1/2 items-center gap-3 rounded-full bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white shadow-xl">
          <GitBranch size={16} className="text-neutral-400" />
          <span>Focused Path View</span>
          <button
            type="button"
            onClick={() => {
              setPickingStyleTarget(null);
              setIsPathView(false);
              setMainShowImagePicker(false);
              setSelectedFrameImages([]);
              setSelectedFrame(null);
              setSelectedWorkspace(null);
            }}
            className="ml-2 rounded-full bg-white/20 p-1 transition-colors hover:bg-white/30"
            aria-label="Close focused path view"
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      {/* Top Navigation */}
      <header className="pointer-events-auto absolute top-0 right-0 left-0 z-30 flex items-center justify-between p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-neutral-600">
          <button
            type="button"
            className="rounded-md p-1 transition-colors hover:bg-neutral-200"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="cursor-pointer hover:text-neutral-900">
            Corgi Character Design
          </span>
          <ChevronDown size={14} className="text-neutral-400" />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-full bg-white p-2 shadow-sm transition-colors hover:bg-neutral-50"
          >
            <Settings size={18} />
          </button>
          <button
            type="button"
            className="rounded-full bg-white px-4 py-1.5 text-sm font-medium shadow-sm transition-colors hover:bg-neutral-50"
          >
            Share
          </button>
        </div>
      </header>

      {/* Bottom Left Controls */}
      <div className="pointer-events-auto absolute bottom-4 left-4 z-30 flex max-w-[calc(100%-420px)] flex-col gap-2">
        <div className="flex items-center gap-2 rounded-full bg-white px-2 py-1 text-sm font-medium shadow-md">
          <button
            type="button"
            className="rounded-full p-1 hover:bg-neutral-100"
            aria-label="Zoom out"
            onClick={() =>
              setView((v) =>
                applyZoomAtViewportCenter(
                  v,
                  v.zoom / ZOOM_STEP_RATIO,
                  viewportRef.current,
                ),
              )
            }
          >
            <Minus size={14} />
          </button>
          <span className="min-w-[2.75rem] text-center tabular-nums">
            {zoomPercentLabel}
          </span>
          <button
            type="button"
            className="rounded-full p-1 hover:bg-neutral-100"
            aria-label="Zoom in"
            onClick={() =>
              setView((v) =>
                applyZoomAtViewportCenter(
                  v,
                  v.zoom * ZOOM_STEP_RATIO,
                  viewportRef.current,
                ),
              )
            }
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Bottom Center Toolbar */}
      <div className="pointer-events-auto absolute bottom-6 left-1/2 z-[300] flex -translate-x-1/2 items-center gap-1 rounded-full bg-white p-1.5 shadow-lg">
        <button
          type="button"
          className="rounded-full bg-neutral-800 p-2.5 text-white transition-colors hover:bg-neutral-700"
        >
          <MousePointer2 size={18} />
        </button>
        <div className="mx-1 h-6 w-px bg-neutral-200" />
        <button
          type="button"
          disabled
          className="cursor-not-allowed rounded-full p-2.5 text-neutral-400 opacity-50 transition-colors"
        >
          <ImageIcon size={18} />
        </button>
        <button
          type="button"
          disabled
          className="cursor-not-allowed rounded-full p-2.5 text-neutral-400 opacity-50 transition-colors"
        >
          <Video size={18} />
        </button>
        <button
          type="button"
          disabled
          className="cursor-not-allowed rounded-full p-2.5 text-neutral-400 opacity-50 transition-colors"
        >
          <AudioLines size={18} />
        </button>
        <div className="mx-1 h-6 w-px bg-neutral-200" />
        <button
          type="button"
          disabled
          className="cursor-not-allowed rounded-full p-2.5 text-neutral-400 opacity-50 transition-colors"
        >
          <Maximize size={18} />
        </button>
        <button
          type="button"
          disabled
          className="cursor-not-allowed rounded-full p-2.5 text-neutral-400 opacity-50 transition-colors"
        >
          <PenTool size={18} />
        </button>
        <button
          type="button"
          disabled
          className="cursor-not-allowed rounded-full p-2.5 text-neutral-400 opacity-50 transition-colors"
        >
          <Type size={18} />
        </button>
        <div className="mx-1 h-6 w-px bg-neutral-200" />
        <button
          type="button"
          disabled
          className="cursor-not-allowed rounded-full p-2.5 text-neutral-400 opacity-50 transition-colors"
        >
          <PlusCircle size={18} />
        </button>
      </div>

      {/* Chat Panel */}
      <div className="pointer-events-auto absolute top-16 right-4 bottom-24 z-[310] flex w-[400px] flex-col overflow-hidden rounded-3xl border border-neutral-100 bg-[#f8f8f8] shadow-xl">
        <div className="flex items-center justify-between p-4 pb-2">
          <h2 className="flex items-center gap-1 text-sm font-bold text-neutral-800">
            Corgi Game Character{" "}
            <ChevronDown size={14} className="text-neutral-800" strokeWidth={2.5} />
          </h2>
          <button
            type="button"
            className="rounded-md p-1 text-neutral-800 hover:bg-neutral-200"
          >
            <Minus size={16} strokeWidth={2.5} />
          </button>
        </div>

        <div ref={feedbackListRef} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-2 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex justify-end">
            <div className="max-w-[68%] rounded-2xl bg-neutral-200/75 px-4 py-3 text-sm leading-relaxed text-neutral-800">
              Create a group of corgi game characters.
            </div>
          </div>

          {/* Generation process card (matches reference layout) */}
          <div className="rounded-2xl border border-neutral-200/60 bg-neutral-100/50 px-4 pb-4 pt-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-semibold text-neutral-900">
                  Corgi Game Character
                </span>
              </div>
              <Check
                className="mt-0.5 h-4 w-4 shrink-0 text-neutral-800"
                strokeWidth={2.5}
                aria-label="Complete"
              />
            </div>
            <p className="mt-2 text-sm text-neutral-500">
              Finished generating 3 Assets
            </p>
            <button
              type="button"
              className="mt-1.5 text-left text-sm font-medium text-neutral-700 underline decoration-neutral-400 underline-offset-2 hover:text-neutral-900"
            >
              Show process
            </button>
            <div className="mt-4 flex gap-2">
              <img
                src="/corgi-wizard.png"
                alt="Preview of generated corgi character"
                className="h-10 w-10 rounded-[4px] object-cover ring-1 ring-black/5"
              />
              <img
                src="/corgi-chef.png"
                alt="Preview of generated corgi character"
                className="h-10 w-10 rounded-[4px] object-cover ring-1 ring-black/5"
              />
              <img
                src="/corgi-pirate.png"
                alt="Preview of generated corgi character"
                className="h-10 w-10 rounded-[4px] object-cover ring-1 ring-black/5"
              />
            </div>
          </div>

          {/* Dynamic Prompts and Generations */}
          {inlineFeedbacks.map((item) => (
            <div key={item.id} className="flex flex-col gap-3 py-6">
              <div className="flex justify-end">
                <div className="max-w-[68%] rounded-2xl bg-neutral-200/75 px-4 py-3 text-sm leading-relaxed text-neutral-800">
                  <div className="space-y-2">
                    {item.inputAsset && item.styleRefSrc ? (
                      <div className="flex min-h-10 flex-wrap items-center gap-1.5 py-1 text-xs leading-none text-neutral-600">
                        <img
                          src={item.inputAsset.src}
                          alt={item.inputAsset.alt}
                          className="h-10 w-10 rounded-[4px] object-cover ring-1 ring-black/5"
                        />
                        <span>{item.frameworkId === "blend" ? "blend with" : "apply style from"}</span>
                        <img
                          src={item.styleRefSrc}
                          alt="Style reference"
                          className="h-10 w-10 rounded-[4px] object-cover ring-1 ring-black/5"
                        />
                      </div>
                    ) : item.inputAsset ? (
                      <div className="flex items-center gap-1.5 py-1">
                        <img
                          src={item.inputAsset.src}
                          alt={item.inputAsset.alt}
                          className="h-10 w-10 rounded-[4px] object-cover ring-1 ring-black/5"
                        />
                      </div>
                    ) : null}
                    {item.userPromptInput ? (
                      <p className="whitespace-pre-wrap break-words">{item.userPromptInput}</p>
                    ) : (!item.promptFrameLines || item.promptFrameLines.length === 0) ? (
                      <p className="whitespace-pre-wrap break-words">{item.prompt}</p>
                    ) : null}
                    {(() => {
                      if (!item.promptFrameLines || item.promptFrameLines.length === 0) return null;
                      const visibleLines = item.promptFrameLines.filter((line) =>
                        item.styleRefSrc
                          ? line !== "Apply style from image" && line !== "Blend with image"
                          : true,
                      );
                      if (visibleLines.length === 0) return null;
                      return (
                        <div className="space-y-1">
                          {visibleLines.map((line, idx) => (
                            <p
                              key={`${item.id}-frame-${idx}`}
                              className="whitespace-pre-wrap break-words text-xs text-neutral-600"
                            >
                              {line}
                            </p>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-1 px-1">
                <div className="flex items-center gap-2 text-sm font-medium text-neutral-700">
                  <Brain size={14} className="text-neutral-500" strokeWidth={2} />
                  Analyzed your request
                </div>
                <div className="pl-6 text-sm text-neutral-500">
                  {item.actionSummary || summarizeChanges(item.scope, item.assetCount)}
                </div>
              </div>
              <div className="rounded-2xl border border-neutral-200/60 bg-neutral-100/50 px-4 pb-4 pt-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-semibold text-neutral-900">
                      {item.frameName ? (
                        item.frameName
                      ) : (
                        <>
                          Generating frame
                          <AnimatedEllipsis />
                        </>
                      )}
                    </span>
                  </div>
                  {item.status === "done" ? (
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-neutral-800" strokeWidth={2.5} />
                  ) : item.status === "analyzing" ? (
                    <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-neutral-500" strokeWidth={2.5} />
                  ) : null}
                </div>
                <div className="mt-2 text-sm text-neutral-500">
                  {item.status === "error" ? (
                    <p>{item.errorMessage ?? "生成失败"}</p>
                  ) : item.showProcess ? (
                    <div className="space-y-1">
                      {(() => {
                        const currentIndex = FEEDBACK_STAGE_ORDER.indexOf(item.status as FeedbackStage);
                        const visibleCount = item.status === "done"
                          ? FEEDBACK_STAGE_ORDER.length
                          : Math.max(currentIndex + 1, 1);
                        return FEEDBACK_STAGE_ORDER.slice(0, visibleCount).map((stage, idx) => {
                          const isCurrent = item.status !== "done" && idx === currentIndex;
                          const isCompleted = item.status === "done" || idx < currentIndex;
                          return (
                            <div key={stage} className="flex items-center gap-2">
                              {isCurrent ? (
                                <Loader2 size={12} className="animate-spin text-neutral-500" strokeWidth={2.5} />
                              ) : isCompleted ? (
                                <Check size={12} className="text-neutral-700" strokeWidth={2.5} />
                              ) : null}
                              <p>{stageLabel(stage)}</p>
                            </div>
                          );
                        });
                      })()}
                      {item.status === "done" ? (
                        <div className="flex items-center gap-2">
                          <Check size={12} className="text-neutral-700" strokeWidth={2.5} />
                          <p>Finished generating 1 Asset</p>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {item.status !== "done" ? (
                        <Loader2 size={12} className="animate-spin text-neutral-500" strokeWidth={2.5} />
                      ) : null}
                      <p>
                        {item.status === "done"
                          ? "Finished generating 1 Asset"
                          : stageLabel(item.status)}
                      </p>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => toggleInlineFeedbackProcess(item.id)}
                  className="mt-2 text-left text-sm font-medium text-neutral-700 underline decoration-neutral-400 underline-offset-2 hover:text-neutral-900"
                >
                  {item.showProcess ? "Hide process" : "Show process"}
                </button>
                {item.status === "done" && item.outputAssets && item.outputAssets.length > 0 ? (
                  <div className="mt-4 flex gap-2">
                    {item.outputAssets.slice(0, 4).map((asset, idx) => (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => {
                          if (!item.workspaceId || !item.frameId) return;
                          setSelectedFrameImages([`${item.workspaceId}|${item.frameId}|${asset.id}`]);
                          setSelectedFrame(null);
                          setSelectedWorkspace(null);
                        }}
                        className={`overflow-hidden rounded-[4px] ring-1 ${
                          idx === 0 ? "ring-black/20" : "ring-black/10"
                        }`}
                        title={idx === 0 ? "Selected variation" : "Generated variation"}
                      >
                        <img src={asset.src} alt={asset.alt} className="h-10 w-10 object-cover" />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))}

        </div>

        <div className="shrink-0 bg-[#f8f8f8] px-4 pb-4 pt-1">
          <div
            className="flex flex-col rounded-2xl border border-neutral-200 bg-white px-4 pb-2.5 pt-3 transition-[padding] duration-300 ease-out"
            onPointerDown={(e) => {
              const t = e.target as HTMLElement;
              if (t.closest("button") || t.closest("input") || t.closest("textarea") || t.closest("[data-main-image-picker]")) return;
              mainMessageRef.current?.focus();
            }}
          >
            <div
              className={`transition-[max-height,margin-bottom,opacity] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
                mainChatAttachedImage
                  ? "mb-2 max-h-14 opacity-100 overflow-visible"
                  : "pointer-events-none mb-0 max-h-0 opacity-0 overflow-hidden"
              }`}
            >
              {mainChatAttachedImage ? (
                <div className="relative inline-block">
                  <img
                    src={mainChatAttachedImage.src}
                    alt={mainChatAttachedImage.alt}
                    className="h-10 w-10 rounded-[4px] object-cover ring-1 ring-black/5"
                  />
                  <button
                    type="button"
                    onClick={() => setSelectedFrameImages([])}
                    className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-neutral-500 text-white shadow-sm transition-colors hover:bg-neutral-700"
                    aria-label="Remove attached image"
                  >
                    <X size={10} strokeWidth={2.5} />
                  </button>
                </div>
              ) : null}
            </div>
            
            {isMainImageSelected && mainSelectedFrameworkQueue.length > 0 ? (
              <div
                className="mb-2 flex flex-col gap-2"
              >
                {mainSelectedFrameworkQueue.map((frameworkId, idx) => {
                  const f = mainFrameworkById[frameworkId];
                  if (!f) return null;
                  return (
                    <div key={`${frameworkId}-${idx}`} className="flex min-h-6 min-w-0 w-full items-center gap-2 text-sm leading-relaxed">
                      <span className="font-semibold text-neutral-900">{f.lead}</span>
                      <span className="text-neutral-400">{f.trail}</span>
                      {f.id === "apply-style" || f.id === "blend" ? (
                        <div className="relative" data-main-image-picker>
                          <button
                            type="button"
                            onClick={() => setMainShowImagePicker(!mainShowImagePicker)}
                            className="flex h-6 w-6 items-center justify-center rounded-[4px] border border-dashed border-neutral-300 bg-neutral-50 text-neutral-400 transition-colors hover:bg-neutral-100"
                            aria-label="Pick style reference image"
                          >
                            {mainReferenceImage ? (
                              <img
                                src={mainReferenceImage}
                                alt="Reference"
                                className="h-full w-full rounded-[4px] object-cover"
                              />
                            ) : (
                              <ImageIcon size={14} />
                            )}
                          </button>
                          {mainShowImagePicker && (
                            <div className="absolute left-0 top-full z-50 mt-1 flex w-48 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg">
                              <button
                                type="button"
                                onClick={() => {
                                  mainFileInputRef.current?.click();
                                  setMainShowImagePicker(false);
                                }}
                                className="flex items-center gap-2 px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100"
                              >
                                <Upload size={14} />
                                Upload from computer
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setPickingStyleTarget("main");
                                  setMainShowImagePicker(false);
                                }}
                                className="flex items-center gap-2 px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100"
                              >
                                <MousePointer2 size={14} />
                                Select from canvas
                              </button>
                            </div>
                          )}
                        </div>
                      ) : f.id === "image-ratio" ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            inputMode="numeric"
                            value={mainRatioWidth}
                            onChange={(e) => setMainRatioWidth(e.target.value.replace(/\D/g, ""))}
                            className="w-8 rounded border border-neutral-200 bg-white px-1 py-0.5 text-center text-[13px] text-neutral-900 outline-none focus:border-neutral-400"
                          />
                          <span className="text-neutral-400">:</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={mainRatioHeight}
                            onChange={(e) => setMainRatioHeight(e.target.value.replace(/\D/g, ""))}
                            className="w-8 rounded border border-neutral-200 bg-white px-1 py-0.5 text-center text-[13px] text-neutral-900 outline-none focus:border-neutral-400"
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
            <input
              type="file"
              ref={mainFileInputRef}
              className="hidden"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setMainReferenceImage(URL.createObjectURL(file));
                }
              }}
            />
            <div className="relative w-full">
              {mainTabCompletionSuffix ? (
                <div
                  className="pointer-events-none absolute inset-0 min-h-[48px] overflow-hidden whitespace-pre text-sm leading-relaxed"
                  aria-hidden
                >
                  <span className="opacity-0">{mainPrompt}</span>
                  <span className="text-neutral-300">{mainTabCompletionSuffix}</span>
                </div>
              ) : null}
              <textarea
                ref={mainMessageRef}
                value={mainPrompt}
                onChange={(e) => setMainPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    isMainImageSelected &&
                    e.key === "Tab" &&
                    mainPredictedFramework &&
                    mainTabCompletionSuffix &&
                    !isMainGenerating
                  ) {
                    e.preventDefault();
                    setMainSelectedFrameworkQueue((prev) => [...prev, mainPredictedFramework.id]);
                    setMainPrompt("");
                    return;
                  }
                  if (
                    isMainImageSelected &&
                    (e.key === "Backspace" || e.key === "Delete") &&
                    mainPrompt === ""
                  ) {
                    if (mainSelectedFrameworkQueue.length > 0) {
                      e.preventDefault();
                      const newQueue = [...mainSelectedFrameworkQueue];
                      const removed = newQueue.pop();
                      setMainSelectedFrameworkQueue(newQueue);
                      if (removed === "apply-style" || removed === "blend") {
                        setMainReferenceImage(null);
                      }
                    }
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleMainGenerate();
                  }
                }}
                placeholder={
                  isMainGenerating
                    ? "生成中…"
                    : isMainImageSelected && mainSelectedFrameworkQueue.length > 0
                      ? ""
                      : "What do you want to do?"
                }
                disabled={isMainGenerating}
                className="min-h-[48px] w-full resize-none bg-transparent text-sm leading-relaxed text-neutral-800 outline-none placeholder:text-neutral-400 disabled:opacity-50"
                rows={2}
              />
            </div>
            <div className="mt-2 flex items-center justify-between">
              <button
                type="button"
                disabled
                title="google/gemini-3.1-flash-image-preview"
                aria-label="Model (inactive)"
                className="flex max-w-[min(7.5rem,38vw)] cursor-not-allowed items-center gap-1 rounded-lg py-1 pr-1 text-left text-xs font-medium text-neutral-300"
              >
                <span className="min-w-0 flex-1 truncate">gemini-3.1-flash-image-preview</span>
                <ChevronsUpDown size={12} className="shrink-0 text-neutral-300" strokeWidth={2} />
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled
                  className="cursor-not-allowed rounded-full p-1.5 text-neutral-300"
                  aria-label="Voice input"
                >
                  <Mic size={18} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={() => void handleMainGenerate()}
                  disabled={(!mainPrompt.trim() && mainSelectedFrameworkQueue.length === 0) || isMainGenerating}
                  className="shrink-0 rounded-full p-1 text-white transition-colors disabled:cursor-default disabled:bg-neutral-300 disabled:opacity-100 enabled:bg-neutral-900 enabled:hover:bg-neutral-800"
                  aria-label="Generate"
                >
                  {isMainGenerating ? (
                    <Loader2 size={14} strokeWidth={2.5} className="animate-spin" />
                  ) : (
                    <ArrowUp size={14} strokeWidth={2.5} />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {clipDraft ? (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/45 p-6">
          <div className="w-full max-w-3xl rounded-2xl bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-800">Freeform Clip</h3>
              <button
                type="button"
                className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100"
                onClick={() => {
                  setClipDraft(null);
                  setClipPathPoints([]);
                  setIsClipDrawing(false);
                }}
              >
                <X size={16} />
              </button>
            </div>
            <div className="relative mx-auto w-full max-w-[760px] overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50">
              <img
                ref={clipImageRef}
                src={clipDraft.src}
                alt="Clip target"
                className="block max-h-[65vh] w-full object-contain"
                draggable={false}
              />
              <svg
                className="absolute inset-0 h-full w-full cursor-crosshair"
                onPointerDown={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setIsClipDrawing(true);
                  setClipPathPoints([{ x: e.clientX - rect.left, y: e.clientY - rect.top }]);
                }}
                onPointerMove={(e) => {
                  if (!isClipDrawing) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const next = { x: e.clientX - rect.left, y: e.clientY - rect.top };
                  setClipPathPoints((prev) => [...prev, next]);
                }}
                onPointerUp={() => setIsClipDrawing(false)}
              >
                {clipPathPoints.length > 1 ? (
                  <polyline
                    points={clipPathPoints.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke="rgba(37,99,235,0.95)"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : null}
              </svg>
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
                onClick={() => setClipPathPoints([])}
              >
                Reset Path
              </button>
              <button
                type="button"
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-neutral-400"
                disabled={clipPathPoints.length < 3}
                onClick={() => {
                  const img = clipImageRef.current;
                  if (!img || clipPathPoints.length < 3) return;
                  const rect = img.getBoundingClientRect();
                  const scaleX = img.naturalWidth / Math.max(rect.width, 1);
                  const scaleY = img.naturalHeight / Math.max(rect.height, 1);
                  const points = clipPathPoints.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }));
                  const minX = Math.min(...points.map((p) => p.x));
                  const minY = Math.min(...points.map((p) => p.y));
                  const maxX = Math.max(...points.map((p) => p.x));
                  const maxY = Math.max(...points.map((p) => p.y));
                  const w = Math.max(1, Math.round(maxX - minX));
                  const h = Math.max(1, Math.round(maxY - minY));
                  const canvas = document.createElement("canvas");
                  canvas.width = w;
                  canvas.height = h;
                  const ctx = canvas.getContext("2d");
                  if (!ctx) return;
                  ctx.save();
                  ctx.beginPath();
                  points.forEach((p, idx) => {
                    const x = p.x - minX;
                    const y = p.y - minY;
                    if (idx === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                  });
                  ctx.closePath();
                  ctx.clip();
                  ctx.drawImage(img, -minX, -minY, img.naturalWidth, img.naturalHeight);
                  ctx.restore();
                  const src = canvas.toDataURL("image/png");
                  const maxEdge = Math.max(w, h);
                  const targetMaxEdge = 90;
                  const scale = clamp(targetMaxEdge / Math.max(maxEdge, 1), 0.08, 1);
                  const displayW = Math.max(32, Math.round(w * scale));
                  const displayH = Math.max(32, Math.round(h * scale));
                  const { x, y } = findOpenCanvasSpot(displayW, displayH);
                  const newClipId = `clip-${Date.now()}`;
                  setClipAssets((prev) => [
                    ...prev,
                    {
                      id: newClipId,
                      src,
                      x,
                      y,
                      width: displayW,
                      height: displayH,
                      rotation: 0,
                    },
                  ]);
                  setSelectedClipIds([newClipId]);
                  setClipDraft(null);
                  setClipPathPoints([]);
                  setIsClipDrawing(false);
                }}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Scissors size={14} />
                  Clip
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {frameContextMenu && (
        <div
          className="fixed z-[1000] flex w-56 flex-col overflow-hidden rounded-3xl border border-neutral-100 bg-[#f8f8f8] py-2.5 shadow-xl"
          style={{
            left: Math.min(frameContextMenu.x, typeof window !== "undefined" ? window.innerWidth - 240 : frameContextMenu.x),
            top: Math.min(frameContextMenu.y, typeof window !== "undefined" ? window.innerHeight - 380 : frameContextMenu.y),
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button type="button" disabled className="flex items-center justify-between px-4 py-1.5 text-[13px] text-neutral-800 opacity-50 cursor-not-allowed">
            <div className="flex items-center gap-3">
              <Play size={15} strokeWidth={2} />
              Make Video
            </div>
            <ChevronRight size={13} strokeWidth={2} />
          </button>
          <button type="button" disabled className="flex items-center justify-between px-4 py-1.5 text-[13px] text-neutral-800 opacity-50 cursor-not-allowed">
            <div className="flex items-center gap-3">
              <ImageIcon size={15} strokeWidth={2} />
              Make Image
            </div>
            <ChevronRight size={13} strokeWidth={2} />
          </button>
          <button type="button" disabled className="flex items-center justify-between px-4 py-1.5 text-[13px] text-neutral-800 opacity-50 cursor-not-allowed">
            <div className="flex items-center gap-3">
              <PenLine size={15} strokeWidth={2} />
              Modify Image
            </div>
            <ChevronRight size={13} strokeWidth={2} />
          </button>

          <div className="my-1.5 mx-4 border-t border-neutral-200/80" />

          <button
            type="button"
            className="flex w-full items-center gap-3 px-4 py-1.5 text-left text-[13px] text-neutral-800 hover:bg-neutral-200/50 transition-colors"
            onClick={() => {
              if (!frameContextMenu) return;
              setWorkspaces((prev) =>
                prev.map((ws) =>
                  ws.id !== frameContextMenu.workspaceId
                    ? ws
                    : {
                        ...ws,
                        frames: ws.frames.map((f) => {
                          if (f.id !== frameContextMenu.frameId) return f;
                          return activeContextFrame?.boardType === "reference"
                            ? { ...f, boardType: undefined }
                            : { ...f, boardType: "reference" };
                        }),
                      }
                )
              );
              setFrameContextMenu(null);
            }}
          >
            <LayoutTemplate size={15} strokeWidth={2} />
            {activeContextFrame?.boardType === "reference" ? "Back to Frame" : "Use as Reference Board"}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-3 px-4 py-1.5 text-left text-[13px] text-neutral-800 hover:bg-neutral-200/50 transition-colors"
            onClick={() => {
              if (!frameContextMenu) return;
              setWorkspaces((prev) =>
                prev.map((ws) =>
                  ws.id !== frameContextMenu.workspaceId
                    ? ws
                    : {
                        ...ws,
                        frames: ws.frames.map((f) => {
                          if (f.id !== frameContextMenu.frameId) return f;
                          return activeContextFrame?.boardType === "mood"
                            ? { ...f, boardType: undefined }
                            : { ...f, boardType: "mood" };
                        }),
                      }
                )
              );
              setFrameContextMenu(null);
            }}
          >
            <Sparkles size={15} strokeWidth={2} />
            {activeContextFrame?.boardType === "mood" ? "Back to Frame" : "Use as Mood Board"}
          </button>

          <div className="my-1.5 mx-4 border-t border-neutral-200/80" />

          <button type="button" disabled className="flex items-center justify-between px-4 py-1.5 text-[13px] text-neutral-800 opacity-50 cursor-not-allowed">
            <div className="flex items-center gap-3">
              <Copy size={15} strokeWidth={2} />
              Copy
            </div>
            <ChevronRight size={13} strokeWidth={2} />
          </button>

          <button type="button" disabled className="flex w-full items-center gap-3 px-4 py-1.5 text-left text-[13px] text-neutral-800 opacity-50 cursor-not-allowed">
            <Download size={15} strokeWidth={2} />
            Download
          </button>

          <div className="my-1.5 mx-4 border-t border-neutral-200/80" />

          <button type="button" disabled className="flex items-center justify-between px-4 py-1.5 text-[13px] text-neutral-800 opacity-50 cursor-not-allowed">
            <div className="flex items-center gap-3">
              <Info size={15} strokeWidth={2} />
              Info
            </div>
            <span className="text-neutral-400 font-medium">I</span>
          </button>
        </div>
      )}
    </div>
  );
}
