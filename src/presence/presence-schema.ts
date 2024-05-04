import { encode, decode } from "@msgpack/msgpack";
import z from "zod";

export type Cursor = {
  x: number;
  y: number;
  pointer: "mouse" | "touch";
};

// user-modifiable fields
export type Presence = {
  cursor?: Cursor | null;
};

// additional fields that are set by the server
// and do not change for the duration of the session
export type User = {
  presence: Presence;
};

export type PartyMessage =
  | {
      type: "sync";
      users: { [id: string]: User };
    }
  | {
      type: "changes";
      add?: { [id: string]: User };
      presence?: { [id: string]: Presence };
      remove?: string[];
    };

export type ClientMessage = {
  type: "update";
  presence: Presence;
};

// Schema created with https://transform.tools/typescript-to-zod
// and then z.union -> z.discriminatedUnion with an additional "type" as first arg

export const cursorSchema = z.object({
  x: z.number(),
  y: z.number(),
  pointer: z.union([z.literal("mouse"), z.literal("touch")]),
});

export const presenceSchema = z.object({
  cursor: cursorSchema.optional().nullable(),
});

export const userSchema = z.object({
  presence: presenceSchema,
});

export const partyMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("sync"),
    users: z.record(userSchema),
  }),
  z.object({
    type: z.literal("changes"),
    add: z.record(userSchema).optional(),
    presence: z.record(presenceSchema).optional(),
    //remove: z.array(z.string()).optional(),
  }),
]);

export const clientMessageSchema = z.object({
  type: z.literal("update"),
  presence: presenceSchema,
});

// parse incoming message (supports json and msgpack)
export function decodeMessage(message: string | ArrayBufferLike) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return typeof message === "string" ? JSON.parse(message) : decode(message);
}

// creates a msgpack message
export function encodePartyMessage(data: z.infer<typeof partyMessageSchema>) {
  return encode(partyMessageSchema.parse(data));
  //return encode(data);
}

export function encodeClientMessage(data: z.infer<typeof clientMessageSchema>) {
  return encode(clientMessageSchema.parse(data));
  //return encode(data);
}

function encodePresence(id: string, presence: Presence) {
  if (presence.cursor == null) {
    return id;
  } else {
    const p = presence.cursor.pointer == "mouse" ? "m" : "t";
    return `${id},${presence.cursor.x},${presence.cursor.y},${p}`;
  }
}
export function encodePartyMessage2(data: PartyMessage) {
  if (data.type == "sync") {
    const v =
        "sync\n"
      + Object.entries(data.users).map(([id, u]) => encodePresence(id, u.presence)).join("\n");
      return v;
  } else {
    const v =
        "add\n"
      + Object.entries(data.add ? data.add : {}).map(([id, u]) => encodePresence(id, u.presence)).join("\n")
      + "\npresence\n"
      + Object.entries(data.presence ? data.presence : {}).map(([id, presence]) => encodePresence(id, presence)).join("\n");
    return v;
  }
}
export function encodeClientMessage2(data: ClientMessage) {
  if (data.presence.cursor == null) {
    //return encode([]);
    return "";
  } else {
    const bleh = data.presence.cursor.pointer == "mouse" ? "m" : "t";
    //return encode([data.presence.cursor.x, data.presence.cursor.y, bleh]);
    return `${data.presence.cursor.x},${data.presence.cursor.y},${bleh}`;
  }
}
export function decodeClientMessage(data: ArrayBufferLike) {
  const a = decode(data);
  if (a instanceof Array && a.length == 3) {
    const p: Presence = {
      cursor: {
        x: +a[0],
        y: +a[1],
        pointer: a[2] == "m" ? "mouse" : "touch",
      },
    };
    return p;
  }
  return {};
}
