export function orderMessageId(orderId: string) {
  return `<orden-${orderId}@fulmar.com>`;
}

export function initialEmailHeaders(messageId: string) {
  return { "Message-ID": messageId };
}

export function replyEmailHeaders(messageId: string) {
  return {
    "In-Reply-To": messageId,
    References: messageId,
  };
}

export async function resolveSentMessageId(
  apiKey: string,
  response: Response,
  fallback: string,
) {
  try {
    const sent = (await response.clone().json()) as { id?: unknown };
    if (typeof sent.id !== "string" || !sent.id) return fallback;
    const detailsResponse = await fetch(
      `https://api.resend.com/emails/${encodeURIComponent(sent.id)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!detailsResponse.ok) return fallback;
    const details = (await detailsResponse.json()) as { message_id?: unknown };
    return typeof details.message_id === "string" && details.message_id
      ? details.message_id
      : fallback;
  } catch {
    return fallback;
  }
}
