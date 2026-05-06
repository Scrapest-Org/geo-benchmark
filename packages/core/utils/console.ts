const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
const originalInfo = console.info;

const getTimestamp = () => {
  const now = new Date();
  return `[${now.toLocaleTimeString("en-GB")}.${now.getMilliseconds()}]`;
};
// const log = Bun.file("log.txt").writer();
// const errorLog = Bun.file("error.txt").writer();
// const warnLog = Bun.file("warn.txt").writer();

console.log = async (...args) => {
  const formattedArgs = args.map((arg) =>
    typeof arg === "object" ? JSON.stringify(arg, null, 2) : arg,
  );
  originalLog(getTimestamp(), ...formattedArgs);

  const fileArgs = args.map((arg) =>
    typeof arg === "object" ? JSON.stringify(arg) : arg,
  );
  // await log.write(getTimestamp() + " " + fileArgs.join(" ") + "\n");
  // await log.flush();
};

console.error = async (...args) => {
  originalError(getTimestamp(), "x|", ...args);
  // await errorLog.write(getTimestamp() + " " + args.join(" ") + "\n");
  // await errorLog.flush();
};

console.warn = async (...args) => {
  originalWarn(getTimestamp(), "!|", ...args);
  // await warnLog.write(getTimestamp() + " " + args.join(" ") + "\n");
  // await warnLog.flush();
};

console.info = async (...args) => {
  originalInfo(getTimestamp(), "🍃|", ...args);
  // await warnLog.write(getTimestamp() + " " + args.join(" ") + "\n");
  // await warnLog.flush();
};
