import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const SUPPORTED_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".pdf",
  ".docx",
  ".html",
  ".json",
  ".csv",
]);

const targetFolder = process.argv[2];

if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is missing from apps/api/.env");
  process.exit(1);
}

if (!targetFolder) {
  console.error("Usage: npm run openai:vector-store -- \"C:\\path\\to\\opsui-docs\"");
  process.exit(1);
}

const folderPath = path.resolve(process.cwd(), targetFolder);

if (!fs.existsSync(folderPath)) {
  console.error(`Folder not found: ${folderPath}`);
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const collectFiles = (directoryPath) => {
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectFiles(entryPath));
      continue;
    }

    if (SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(entryPath);
    }
  }

  return files;
};

const sourceFiles = collectFiles(folderPath);

if (!sourceFiles.length) {
  console.error(
    "No supported files found. Add .md, .txt, .pdf, .docx, .html, .json, or .csv files.",
  );
  process.exit(1);
}

const storeName = `OpsUI Knowledge Base ${new Date().toISOString().slice(0, 10)}`;

console.log(`Creating vector store: ${storeName}`);
console.log(`Found ${sourceFiles.length} file(s) to upload.`);

const vectorStore = await openai.vectorStores.create({
  name: storeName,
  description: "OpsUI sales, product, and demo knowledge base",
});

const uploadStreams = sourceFiles.map((filePath) => fs.createReadStream(filePath));

const batch = await openai.vectorStores.fileBatches.uploadAndPoll(vectorStore.id, {
  files: uploadStreams,
});

console.log("");
console.log(`Vector store created: ${vectorStore.id}`);
console.log(`Batch status: ${batch.status}`);
console.log(
  `Files processed: ${batch.file_counts.completed}/${batch.file_counts.total}`,
);

if (batch.file_counts.failed > 0) {
  console.log(`Files failed: ${batch.file_counts.failed}`);
}

console.log("");
console.log("Paste this into apps/api/.env:");
console.log(`OPSUI_OPENAI_VECTOR_STORE_ID=${vectorStore.id}`);
