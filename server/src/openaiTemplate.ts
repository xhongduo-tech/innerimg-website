export type OpenAIVisionRequestBody = {
  model: string;
  messages: Array<{
    role: "user";
    content: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;
  }>;
};

export function buildOpenAIVisionRequest(input: {
  model: string;
  prompt: string;
  imageUrls: string[];
  dataUrl?: string | null;
}): OpenAIVisionRequestBody {
  const content: OpenAIVisionRequestBody["messages"][number]["content"] = [
    { type: "text", text: input.prompt },
  ];
  for (const url of input.imageUrls) {
    const u = url.trim();
    if (u) content.push({ type: "image_url", image_url: { url: u } });
  }
  if (input.dataUrl?.trim()) {
    content.push({
      type: "image_url",
      image_url: { url: input.dataUrl.trim() },
    });
  }
  return {
    model: input.model,
    messages: [{ role: "user", content }],
  };
}

export function curlOpenAIChatCompletions(jsonPretty: string): string {
  return [
    'curl -sS https://api.openai.com/v1/chat/completions \\',
    '  -H "Content-Type: application/json" \\',
    '  -H "Authorization: Bearer $OPENAI_API_KEY" \\',
    "  -d @- <<'EOF'",
    jsonPretty,
    "EOF",
  ].join("\n");
}

export function pythonOpenAIChatCompletions(requestBody: OpenAIVisionRequestBody): string {
  const embedded = JSON.stringify(requestBody, null, 4);
  return `import json
import os
import urllib.request

payload = json.loads(r"""${embedded}""")

req = urllib.request.Request(
    "https://api.openai.com/v1/chat/completions",
    data=json.dumps(payload).encode("utf-8"),
    headers={
        "Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}",
        "Content-Type": "application/json",
    },
    method="POST",
)

with urllib.request.urlopen(req, timeout=120) as resp:
    print(resp.read().decode())
`;
}
