import { NextResponse } from "next/server";

const DEFAULT_BASE = "https://ai-gateway.vercel.sh/v1";

type ChatCompletionPayload = {
  choices?: Array<{
    message?: {
      images?: Array<{
        type?: string;
        image_url?: { url?: string };
      }>;
      content?: unknown;
    };
  }>;
};

const PLACEHOLDER_IMAGES = [
  "/corgi-wizard.png",
  "/corgi-chef.png",
  "/corgi-pirate.png",
];

function extractTextContent(content: unknown): string | null {
  if (typeof content === "string" && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const p = part as { type?: string; text?: string };
      if (p.type === "text" && typeof p.text === "string" && p.text.trim()) {
        return p.text.trim();
      }
    }
  }
  return null;
}

function firstImageUrlFromList(
  images: Array<{ type?: string; image_url?: { url?: string } }>,
): string | null {
  for (const img of images) {
    const u = img?.image_url?.url;
    if (typeof u === "string" && u.length > 0) {
      return u;
    }
  }
  return null;
}

function extractImageDataUrl(data: ChatCompletionPayload): string | null {
  const message = data.choices?.[0]?.message;
  const fromImages = message?.images;
  if (Array.isArray(fromImages) && fromImages.length > 0) {
    const u = firstImageUrlFromList(fromImages);
    if (u) return u;
  }

  const content = message?.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const p = part as { type?: string; image_url?: { url?: string } };
      if (p.image_url?.url) return p.image_url.url;
    }
  }
  return null;
}

function fallbackFrameName(prompt: string): string {
  const p = prompt.trim();
  if (!p) return "Untitled Frame";
  return p.length > 24 ? `${p.slice(0, 24)}…` : p;
}

function fallbackActionSummary(prompt: string): string {
  const p = prompt.trim().replace(/\s+/g, " ");
  if (!p) return "Analyzing your request and preparing a visual update for the image.";
  const clipped = p.length > 120 ? `${p.slice(0, 120)}...` : p;
  return `AI interpretation: apply "${clipped}" to generate an updated visual result.`;
}

async function summarizeFrameNameAndAction(
  prompt: string,
  base: string,
  apiKey: string,
): Promise<{ frameName: string; actionSummary: string }> {
  try {
    const resp = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content:
              "You are an AI assistant in a design tool. The user provides a prompt to edit or generate images. Return exactly a JSON object with two fields:\n1. 'frameName': A concise visual design frame title (2-5 words).\n2. 'actionSummary': A brief, one-sentence summary of what you understand you need to do to the image based on the prompt (e.g. 'Converting the character to pixel art style.', 'Changing the background to a sunny beach.').",
          },
          {
            role: "user",
            content: `Analyze this image-edit request:\n${prompt}`,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 100,
      }),
    });
    if (!resp.ok) {
      return {
        frameName: fallbackFrameName(prompt),
        actionSummary: fallbackActionSummary(prompt),
      };
    }
    const data = (await resp.json()) as ChatCompletionPayload;
    const raw = extractTextContent(data.choices?.[0]?.message?.content);
    if (!raw) {
      return {
        frameName: fallbackFrameName(prompt),
        actionSummary: fallbackActionSummary(prompt),
      };
    }
    
    try {
      const parsed = JSON.parse(raw);
      const frameName = parsed.frameName || fallbackFrameName(prompt);
      const actionSummary = parsed.actionSummary || fallbackActionSummary(prompt);
      return { frameName, actionSummary };
    } catch {
      return {
        frameName: fallbackFrameName(prompt),
        actionSummary: fallbackActionSummary(prompt),
      };
    }
  } catch {
    return {
      frameName: fallbackFrameName(prompt),
      actionSummary: fallbackActionSummary(prompt),
    };
  }
}

export async function POST(req: Request) {
  try {
    const { prompt, image, styleImage } = (await req.json()) as {
      prompt?: string;
      image?: string;
      styleImage?: string;
    };

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }

    const gatewayEnabled =
      (process.env.AI_GATEWAY_ENABLED ?? "false").toLowerCase() === "true";
    if (!gatewayEnabled) {
      const idx = Math.floor(Math.random() * PLACEHOLDER_IMAGES.length);
      return NextResponse.json({
        imageUrl: PLACEHOLDER_IMAGES[idx],
        frameName: fallbackFrameName(prompt.trim()),
        actionSummary: fallbackActionSummary(prompt.trim()),
      });
    }

    const apiKey =
      process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN;
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "Missing AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN). Add it to .env.local.",
        },
        { status: 500 },
      );
    }

    const base =
      process.env.AI_GATEWAY_BASE_URL?.replace(/\/$/, "") ?? DEFAULT_BASE;

    const messages: unknown[] = [];
    const content: unknown[] = [];

    if (prompt.trim()) {
      content.push({ type: "text", text: prompt.trim() });
    }
    if (image && typeof image === "string") {
      content.push({ type: "image_url", image_url: { url: image } });
    }
    if (styleImage && typeof styleImage === "string") {
      content.push({ type: "image_url", image_url: { url: styleImage } });
    }

    if (content.length > 0) {
      if (content.length === 1 && (content[0] as any).type === "text") {
        messages.push({ role: "user", content: prompt.trim() });
      } else {
        messages.push({ role: "user", content });
      }
    }

    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3.1-flash-image-preview",
        messages,
        modalities: ["text", "image"],
      }),
    });

    const data = (await response.json()) as ChatCompletionPayload & {
      error?: unknown;
    };

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error ?? "Failed to generate image" },
        { status: response.status },
      );
    }

    const imageUrl = extractImageDataUrl(data);
    if (!imageUrl) {
      return NextResponse.json(
        {
          error: "Model returned no image",
          hint: "Ensure modalities include image and the model supports image output.",
        },
        { status: 502 },
      );
    }

    const { frameName, actionSummary } = await summarizeFrameNameAndAction(prompt.trim(), base, apiKey);
    return NextResponse.json({ imageUrl, frameName, actionSummary });
  } catch (error) {
    console.error("Error generating image:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
