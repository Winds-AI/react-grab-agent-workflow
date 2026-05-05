#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdirSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = new Map(
  process.argv.slice(2).flatMap((arg, index, allArgs) => {
    if (!arg.startsWith("--")) return [];
    const [key, inlineValue] = arg.slice(2).split("=");
    return [[key, inlineValue ?? allArgs[index + 1]]];
  }),
);

const port = Number(args.get("port") ?? process.env.PORT ?? 8787);
const logFile = resolve(
  args.get("log") ?? process.env.REACT_GRAB_FEEDBACK_LOG ?? "logs/react-grab-feedback.jsonl",
);
const screenshotsDir = resolve(
  args.get("screenshots") ?? process.env.REACT_GRAB_SCREENSHOTS_DIR ?? "logs/screenshots",
);

const jobs = new Map();
let jobCounter = 0;
const SCREENSHOT_PADDING_CSS_PX = 8;

const appendLog = (entry) => {
  mkdirSync(dirname(logFile), { recursive: true });
  appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
};

const assertFiniteNumber = (value, name) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Missing screenshot crop value: ${name}`);
  }
  return value;
};

const getCropRegion = (bounds, viewport, metadata) => {
  if (!bounds || typeof bounds !== "object") {
    throw new Error("Missing selected element bounds for screenshot crop");
  }
  const viewportWidth = assertFiniteNumber(viewport?.width, "viewport.width");
  const viewportHeight = assertFiniteNumber(viewport?.height, "viewport.height");
  const boundsX = assertFiniteNumber(bounds.x, "bounds.x");
  const boundsY = assertFiniteNumber(bounds.y, "bounds.y");
  const boundsWidth = assertFiniteNumber(bounds.width, "bounds.width");
  const boundsHeight = assertFiniteNumber(bounds.height, "bounds.height");
  const imageWidth = assertFiniteNumber(metadata.width, "image.width");
  const imageHeight = assertFiniteNumber(metadata.height, "image.height");

  const pixelRatioX = imageWidth / Math.max(1, viewportWidth);
  const pixelRatioY = imageHeight / Math.max(1, viewportHeight);
  const left = Math.floor(Math.max(0, (boundsX - SCREENSHOT_PADDING_CSS_PX) * pixelRatioX));
  const top = Math.floor(Math.max(0, (boundsY - SCREENSHOT_PADDING_CSS_PX) * pixelRatioY));
  const right = Math.ceil(
    Math.min(imageWidth, (boundsX + boundsWidth + SCREENSHOT_PADDING_CSS_PX) * pixelRatioX),
  );
  const bottom = Math.ceil(
    Math.min(imageHeight, (boundsY + boundsHeight + SCREENSHOT_PADDING_CSS_PX) * pixelRatioY),
  );
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);

  return { left, top, width, height };
};

const saveScreenshotDataUrl = async (dataUrl, jobId, index, bounds, viewport) => {
  const match = /^data:(image\/png|image\/jpeg);base64,(.+)$/u.exec(dataUrl);
  if (!match) {
    throw new Error(`Comment ${index + 1} is missing a PNG/JPEG screenshot data URL`);
  }

  const extension = match[1] === "image/png" ? "png" : "jpg";
  const screenshotPath = resolve(screenshotsDir, jobId, `comment-${index + 1}.${extension}`);
  mkdirSync(dirname(screenshotPath), { recursive: true });
  const fullScreenshot = Buffer.from(match[2], "base64");
  const image = sharp(fullScreenshot);
  const metadata = await image.metadata();
  const region = getCropRegion(bounds, viewport, metadata);

  await image.extract(region).toFile(screenshotPath);
  return { path: screenshotPath, crop: region };
};

const persistScreenshots = async (payload, jobId) => {
  const sanitizedPayload = structuredClone(payload);
  if (!Array.isArray(sanitizedPayload.comments) || sanitizedPayload.comments.length === 0) {
    throw new Error("Feedback payload must include at least one comment");
  }
  for (const [index, comment] of sanitizedPayload.comments.entries()) {
    const dataUrl = comment.screenshot?.dataUrl;
    if (typeof dataUrl !== "string") {
      throw new Error(`Comment ${index + 1} is missing screenshot data`);
    }

    const savedScreenshot = await saveScreenshotDataUrl(
      dataUrl,
      jobId,
      index,
      comment.screenshot?.bounds,
      comment.context?.viewport,
    );
    comment.screenshot = {
      ...comment.screenshot,
      kind: "selected-element-crop",
      sourceKind: comment.screenshot.kind,
      dataUrl: undefined,
      path: savedScreenshot.path,
      crop: savedScreenshot.crop,
    };
    delete comment.screenshot.dataUrl;
  }
  return sanitizedPayload;
};

const readBody = (req) =>
  new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
    req.on("error", rejectBody);
  });

const sendJson = (res, statusCode, body) => {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
};

const shouldFailJob = (payload) => {
  const searchable = (payload.comments ?? [])
    .map((comment) => comment.userFeedback)
    .filter((value) => typeof value === "string")
    .join("\n")
    .toLowerCase();
  return searchable.includes("fail") || jobCounter % 3 === 0;
};

const handleFeedbackCreate = async (req, res) => {
  try {
    const body = await readBody(req);
    const payload = JSON.parse(body.toString("utf8"));
    jobCounter += 1;
    const jobId = `mock-agent-${Date.now()}-${jobCounter}`;
    const startedAt = Date.now();
    const durationMs = 1200 + Math.floor(Math.random() * 2200);
    const willFail = shouldFailJob(payload);

    jobs.set(jobId, {
      jobId,
      state: "working",
      startedAt,
      completedAt: startedAt + durationMs,
      willFail,
    });

    const sanitizedPayload = await persistScreenshots(payload, jobId);

    appendLog({
      type: "feedback",
      jobId,
      receivedAt: new Date(startedAt).toISOString(),
      payload: sanitizedPayload,
    });

    setTimeout(() => {
      const job = jobs.get(jobId);
      if (!job) return;
      job.state = willFail ? "failed" : "completed";
      job.error = willFail ? "Mock agent failed while applying feedback." : undefined;
      appendLog({
        type: "agent-status",
        jobId,
        state: job.state,
        completedAt: new Date().toISOString(),
        error: job.error,
      });
    }, durationMs);

    sendJson(res, 202, { jobId, state: "working" });
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : "Invalid feedback payload",
    });
  }
};

const handleFeedbackStatus = (req, res) => {
  const jobId = decodeURIComponent(req.url.split("/").pop() ?? "");
  const job = jobs.get(jobId);
  if (!job) {
    sendJson(res, 404, { error: "Unknown job" });
    return;
  }
  sendJson(res, 200, {
    jobId,
    state: job.state,
    error: job.error,
  });
};

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/__react-grab-agent-feedback") {
    void handleFeedbackCreate(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/__react-grab-agent-feedback/")) {
    handleFeedbackStatus(req, res);
    return;
  }

  sendJson(res, 404, { error: "Unknown mock agent endpoint route" });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`React Grab mock agent endpoint: http://localhost:${port}`);
  console.log(`Feedback log: ${logFile}`);
  console.log(`Screenshots: ${screenshotsDir}`);
});
