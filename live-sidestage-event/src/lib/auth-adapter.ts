import type { Adapter, AdapterAccount, AdapterUser } from "next-auth/adapters";
import cuid from "cuid";
import { prisma } from "@/lib/prisma";

// live-sidestage-analytics と同じ public."User" / public."Account" を使うための NextAuth アダプタ。
//
// なぜ PrismaAdapter を使わないか:
//   Prisma で public のモデルを宣言すると、そのスキーマが `prisma db push` の管理対象に入る。
//   Prisma 5.x には「このテーブルは他が管理している」と宣言する手段がないため、
//   schema.prisma に書いていない gifts / TiktokRoom / Streamer が削除差分として扱われる。
//   analytics の本番デプロイは `db push --accept-data-loss` なので、事故ると復旧できない。
//
// このファイルと src/lib/analytics-db.ts だけが public スキーマを触る。
// Prisma の multiSchema は raw SQL を自動修飾しないので、必ず `public."User"` のように
// 完全修飾し、大文字小文字も正確に書くこと。値は必ずタグ付きテンプレートでパラメータ化する
// ($queryRawUnsafe とテーブル名の動的補間は使わない)。
//
// session: { strategy: "jwt" } なので Session 系のメソッドは呼ばれない。
// 型を満たすためだけに定義し、万一呼ばれたら気づけるよう明示的に throw する。

type UserRow = {
  id: string;
  name: string | null;
  email: string | null;
  emailVerified: Date | null;
  image: string | null;
};

const USER_COLUMNS = `id, name, email, "emailVerified", image`;

function toAdapterUser(row: UserRow): AdapterUser {
  return {
    id: row.id,
    name: row.name,
    // AdapterUser.email は string 必須だが、analytics の User.email は nullable。
    // 実際に email なしのユーザーが OAuth 経由で作られることはない。
    email: row.email ?? "",
    emailVerified: row.emailVerified,
    image: row.image,
  };
}

function first(rows: UserRow[]): AdapterUser | null {
  return rows.length > 0 ? toAdapterUser(rows[0]) : null;
}

function notUsed(method: string): never {
  throw new Error(
    `[auth-adapter] ${method} は JWT strategy では呼ばれないはず。session.strategy の設定を確認すること。`
  );
}

export function SharedUserAdapter(): Adapter {
  return {
    // Adapter["createUser"] は union 型なので contextual typing が効かない。引数の型を明示する。
    async createUser(user: Omit<AdapterUser, "id">) {
      const id = cuid();
      await prisma.$executeRaw`
        INSERT INTO public."User" (id, name, email, "emailVerified", image, "createdAt")
        VALUES (${id}, ${user.name ?? null}, ${user.email || null}, ${user.emailVerified}, ${user.image ?? null}, NOW())
      `;
      return { ...user, id };
    },

    async getUser(id) {
      const rows = await prisma.$queryRaw<UserRow[]>`
        SELECT id, name, email, "emailVerified", image FROM public."User" WHERE id = ${id} LIMIT 1
      `;
      return first(rows);
    },

    async getUserByEmail(email) {
      const rows = await prisma.$queryRaw<UserRow[]>`
        SELECT id, name, email, "emailVerified", image FROM public."User" WHERE email = ${email} LIMIT 1
      `;
      return first(rows);
    },

    // ここが「ユーザーIDを全サービス共通にする」中核。
    // analytics で既にログインしたことがある Google アカウントなら、
    // その Account 行から同じ User.id が返る。
    async getUserByAccount({ provider, providerAccountId }) {
      const rows = await prisma.$queryRaw<UserRow[]>`
        SELECT u.id, u.name, u.email, u."emailVerified", u.image
        FROM public."Account" a
        JOIN public."User" u ON u.id = a."userId"
        WHERE a.provider = ${provider} AND a."providerAccountId" = ${providerAccountId}
        LIMIT 1
      `;
      return first(rows);
    },

    // UPDATE できる列は GRANT で name / email / emailVerified / image に限定してある
    // (password を触らせないため)。
    async updateUser(user) {
      const rows = await prisma.$queryRaw<UserRow[]>`
        UPDATE public."User"
        SET name = COALESCE(${user.name ?? null}, name),
            email = COALESCE(${user.email || null}, email),
            "emailVerified" = COALESCE(${user.emailVerified ?? null}, "emailVerified"),
            image = COALESCE(${user.image ?? null}, image)
        WHERE id = ${user.id}
        RETURNING id, name, email, "emailVerified", image
      `;
      if (rows.length === 0) throw new Error(`[auth-adapter] updateUser: user not found: ${user.id}`);
      return toAdapterUser(rows[0]);
    },

    async linkAccount(account: AdapterAccount) {
      const id = cuid();
      await prisma.$executeRaw`
        INSERT INTO public."Account"
          (id, "userId", type, provider, "providerAccountId",
           refresh_token, access_token, expires_at, token_type, scope, id_token, session_state)
        VALUES
          (${id}, ${account.userId}, ${account.type}, ${account.provider}, ${account.providerAccountId},
           ${account.refresh_token ?? null}, ${account.access_token ?? null},
           ${account.expires_at ?? null}, ${account.token_type ?? null},
           ${account.scope ?? null}, ${account.id_token ?? null}, ${account.session_state ?? null})
        ON CONFLICT (provider, "providerAccountId") DO NOTHING
      `;
      return account;
    },

    // --- 以下は JWT strategy では呼ばれない。DELETE 権限も与えていない。 ---
    async createSession() {
      return notUsed("createSession");
    },
    async getSessionAndUser() {
      return notUsed("getSessionAndUser");
    },
    async updateSession() {
      return notUsed("updateSession");
    },
    async deleteSession() {
      return notUsed("deleteSession");
    },
  };
}
