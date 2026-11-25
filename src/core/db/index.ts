// DB repository for shareable reports and leads (T004). The v2 scan loop is stateless; only the lazy client exists now.
export { getDbClient, type DbClientResult } from "./client";
