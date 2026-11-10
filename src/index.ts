import fs from 'node:fs';
import { readConfig } from './action/config';
import { openRepository } from './action/repository';
import { synchronize } from './sync';

function main(): void {
  const config = readConfig();
  const repository = openRepository(config.root);
  const { base, head } = repository.readComparison(config);

  const updates = synchronize({
    base,
    head,
    sources: config.sources,
    globalPath: config.globalPath,
    swiftToolsVersion: config.swiftToolsVersion,
  });
  const commitSHA = repository.commitAndPush(updates, config);

  const output = commitSHA ? `changed=true\ncommit-sha=${commitSHA}\n` : 'changed=false\n';
  fs.appendFileSync(config.outputPath, output);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
