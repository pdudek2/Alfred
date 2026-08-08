export function electronArguments(userDataDirectory) {
  const args = ["."];
  const directory = userDataDirectory?.trim();
  if (directory) args.push(`--user-data-dir=${directory}`);
  return args;
}
