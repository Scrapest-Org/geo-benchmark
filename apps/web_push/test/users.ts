import { getAllUserInfo } from "../src/helpers";

const res = await getAllUserInfo();

console.log(res[0], typeof res[0]);
process.exit(0);
