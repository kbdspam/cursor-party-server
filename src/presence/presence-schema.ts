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
    remove: z.array(z.string()).optional(),
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
      + Object.entries(data.presence ? data.presence : {}).map(([id, presence]) => encodePresence(id, presence)).join("\n")
      + "\nremove\n"
      + Object.entries(data.remove ? data.remove : {}).join("\n");
    return v;
  }
}
function encodeFuckFuck(
  add?: { [id: string]: User },
  presence?: { [id: string]: Presence },
  remove?: string[])
{
  let number_of_u32s = 0;
  let number_of_add = 0;
  let number_of_presence = 0;
  let number_of_remove = 0;
  if (add) {
    number_of_add = Object.keys(add).length;
    if (number_of_add) {
      number_of_u32s +=
          1 // type
        + 1 // count
        + (3 * number_of_add);
    }
  }
  if (presence) {
    number_of_presence = Object.keys(presence).length;
    if (number_of_presence) {
      number_of_u32s +=
          1 // type
        + 1 // count
        + (3 * number_of_presence);
    }
  }
  if (remove) {
    number_of_remove = remove.length;
    if (number_of_remove) {
      number_of_u32s +=
          1 // type
        + 1 // count
        + (1 * number_of_remove);
    }
  }
  const buffer = new ArrayBuffer(number_of_u32s * 4);
  let pos = 0;
  const u32 = new Uint32Array(buffer);
  const f32 = new Float32Array(buffer);
  if (add && number_of_add) {
    u32[pos++] = 2; // presence type
    u32[pos++] = number_of_add;
    for (const [i, v] of Object.entries(add).entries()) {
      u32[pos++] = +v[0]; //| (v[1].presence.cursor?.pointer == "mouse" ? 0 : (1<<31));
      f32[pos++] = v[1].presence.cursor?.x ? v[1].presence.cursor?.x : 0;
      f32[pos++] = v[1].presence.cursor?.y ? v[1].presence.cursor?.y : 0;
    }
  }
  if (presence && number_of_presence) {
    u32[pos++] = 2; // presence type
    u32[pos++] = number_of_presence;
    for (const [i, v] of Object.entries(presence).entries()) {
      u32[pos++] = +v[0]; //| (v[1].cursor?.pointer == "mouse" ? 0 : (1<<31));
      f32[pos++] = v[1].cursor?.x ? v[1].cursor?.x : 0;
      f32[pos++] = v[1].cursor?.y ? v[1].cursor?.y : 0;
    }
  }
  if (remove && number_of_remove) {
    u32[pos++] = 3; // remove type
    u32[pos++] = number_of_remove;
    for (const [i, v] of remove.entries()) {
      u32[pos++] = +v;
    }
  }
  return buffer;
}
export function encodePartyMessage3(data: PartyMessage) {
  if (data.type == "sync") {
    return encodeFuckFuck(data.users);
  } else {
    return encodeFuckFuck(data.add, data.presence, data.remove);
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
export function encodeClientMessage3(data: ClientMessage) {
  if (data.presence.cursor) {
    const buffer = new ArrayBuffer(2 * 4);
    const f32 = new Float32Array(buffer);
    f32[0] = data.presence.cursor.x;
    f32[1] = data.presence.cursor.y;
    //f32[2] = data.presence.cursor.pointer == "mouse" ? 0.0 : 1.0;
    return buffer;
  } else {
    return new ArrayBuffer(12);
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
