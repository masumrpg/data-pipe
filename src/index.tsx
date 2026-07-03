import { render } from 'ink';
import { readFileSync, existsSync } from 'fs';
import { resolve, extname } from 'path';
import * as yaml from 'js-yaml';
import { App } from './ui/App';
import type { PipelineConfig } from './shared/types';
import {
  configError,
  fileError,
  parseError,
  validateConfig,
  formatErrorForTerminal,
} from './shared/errors';


function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
  };

  return {
    pipelinePath: get('--pipeline') ?? get('-p'),
    dryRun: args.includes('--dry-run'),
    testConn: args.includes('--test-connection'),
    retry: args.includes('--retry'),
    autoQuit: args.includes('--auto-quit') || args.includes('-q'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

function printUsage() {
  console.log(`
  \x1b[1;36mDataPipe\x1b[0m — Generic data pipeline CLI

  \x1b[1mUsage:\x1b[0m
    bun run src/index.tsx --pipeline <path/to/config.json>

  \x1b[1mOptions:\x1b[0m
    --pipeline, -p <path>   Path to the pipeline configuration file (JSON/YAML)
    --dry-run               Fetch + map data without writing to target database
    --test-connection       Only test connection to the target database
    --retry                 Retry failed items from the previous pipeline run
    --auto-quit, -q         Auto-quit the process when complete or on error
    --help, -h              Display this help menu

  \x1b[1mExamples:\x1b[0m
    bun run src/index.tsx --pipeline pipelines/my-project/pipeline.json
    bun run src/index.tsx -p pipelines/my-project/pipeline.json --dry-run

  \x1b[1mKeyboard controls during execution:\x1b[0m
    [p] pause/resume   [c] cancel   [r] retry failed   [q] quit
  `);
}

function loadConfig(pipelinePath: string): PipelineConfig {
  const fullPath = resolve(pipelinePath);

  // Check file exists
  if (!existsSync(fullPath)) {
    throw fileError(fullPath);
  }

  // Read file
  let raw: string;
  try {
    raw = readFileSync(fullPath, 'utf-8');
  } catch (err: any) {
    throw fileError(fullPath, err);
  }

  // Check empty file
  if (raw.trim().length === 0) {
    throw configError(`Configuration file is empty: ${fullPath}`, 'Add a valid pipeline configuration structure.');
  }

  // Parse JSON or YAML
  let parsed: unknown;
  const ext = extname(pipelinePath).toLowerCase();

  if (ext === '.yaml' || ext === '.yml') {
    try {
      parsed = yaml.load(raw);
    } catch (err: any) {
      throw parseError(fullPath, 'YAML', err);
    }
  } else if (ext === '.json') {
    try {
      parsed = JSON.parse(raw);
    } catch (err: any) {
      throw parseError(fullPath, 'JSON', err);
    }
  } else {
    throw configError(
      `File extension "${ext}" is not supported.`,
      'Use a .json, .yaml, or .yml file.',
    );
  }

  // Validate config structure
  validateConfig(parsed);

  return parsed;
}

async function main() {
  const { pipelinePath, dryRun, autoQuit, help } = parseArgs();

  if (help) {
    printUsage();
    process.exit(0);
  }

  if (!pipelinePath) {
    console.error(formatErrorForTerminal(
      configError(
        'Pipeline configuration path is required.',
        'Use: bun run src/index.tsx --pipeline <path/to/config.json>\nRun with --help for full usage instructions.',
      ),
    ));
    process.exit(1);
  }

  const config = loadConfig(pipelinePath);
  
  let success = true;
  const { waitUntilExit } = render(
    <App
      config={config}
      dryRun={dryRun}
      autoQuit={autoQuit}
      onComplete={(isSuccess) => {
        success = isSuccess;
      }}
    />
  );
  
  await waitUntilExit();
  if (!success) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(formatErrorForTerminal(err));
  process.exit(1);
});
