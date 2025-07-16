import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import ini from 'ini';
import type { TiktokenModel } from '@dqbd/tiktoken';
import { commandName } from './constants';
import { KnownError, handleCliError } from './error';
import * as p from '@clack/prompts';
import { red } from 'kolorist';
import i18n from './i18n';
import { getModels } from './completion';
import { Model } from 'openai';

const { hasOwnProperty } = Object.prototype;
export const hasOwn = (object: unknown, key: PropertyKey) =>
  hasOwnProperty.call(object, key);

const languagesOptions = Object.entries(i18n.languages).map(([key, value]) => ({
  value: key,
  label: value,
}));

const parseAssert = (name: string, condition: any, message: string) => {
  if (!condition) {
    throw new KnownError(
      `${i18n.t('Invalid config property')} ${name}: ${message}`
    );
  }
};

const configParsers = {
  API_KEY(key?: string) {
    if (!key) {
      throw new KnownError(
        `Please set your API key via \`${commandName} config set API_KEY=<your token>\``
      );
    }
    return key;
  },
  MODEL(model?: string) {
    if (!model || model.length === 0) {
      return 'gpt-4o-mini';
    }
    return model as TiktokenModel;
  },
  SILENT_MODE(mode?: string) {
    return String(mode).toLowerCase() === 'true';
  },
  API_ENDPOINT(apiEndpoint?: string) {
    return apiEndpoint || 'https://api.openai.com/v1';
  },
  LANGUAGE(language?: string) {
    return language || 'en';
  },
  PROVIDER(provider?: string) {
    if (!provider || provider.length === 0) {
      return 'openai';
    }
    if (provider !== 'openai' && provider !== 'local') {
      throw new KnownError(`Invalid provider: ${provider}. Supported providers: openai, local`);
    }
    return provider;
  },
} as const;

type ConfigKeys = keyof typeof configParsers;

type RawConfig = {
  [key in ConfigKeys]?: string;
};

type ValidConfig = {
  [Key in ConfigKeys]: ReturnType<(typeof configParsers)[Key]>;
};

const configPath = path.join(os.homedir(), '.ai-shell');

const fileExists = (filePath: string) =>
  fs.lstat(filePath).then(
    () => true,
    () => false
  );

const readConfigFile = async (): Promise<RawConfig> => {
  const configExists = await fileExists(configPath);
  if (!configExists) {
    return Object.create(null);
  }

  const configString = await fs.readFile(configPath, 'utf8');
  return ini.parse(configString);
};

export const getConfig = async (
  cliConfig?: RawConfig
): Promise<ValidConfig> => {
  const config = await readConfigFile();
  const parsedConfig: Record<string, unknown> = {};

  for (const key of Object.keys(configParsers) as ConfigKeys[]) {
    const parser = configParsers[key];
    const value = cliConfig?.[key] ?? config[key];
    parsedConfig[key] = parser(value);
  }

  return parsedConfig as ValidConfig;
};

export const setConfigs = async (keyValues: [key: string, value: string][]) => {
  const config = await readConfigFile();

  for (const [key, value] of keyValues) {
    if (!hasOwn(configParsers, key)) {
      throw new KnownError(`${i18n.t('Invalid config property')}: ${key}`);
    }

    const parsed = configParsers[key as ConfigKeys](value);
    config[key as ConfigKeys] = parsed as any;
  }

  await fs.writeFile(configPath, ini.stringify(config), 'utf8');
};

export const showConfigUI = async () => {
  try {
    const config = await getConfig();
    
    const options = [
      {
        label: i18n.t('Provider'),
        value: 'PROVIDER' as const,
        hint: hasOwn(config, 'PROVIDER')
          ? config.PROVIDER
          : i18n.t('(not set)'),
      },
      {
        label: i18n.t('API Key'),
        value: 'API_KEY' as const,
        hint: hasOwn(config, 'API_KEY')
          ? 'sk-...' + config.API_KEY.slice(-3)
          : i18n.t('(not set)'),
      },
      {
        label: i18n.t('API Endpoint'),
        value: 'API_ENDPOINT' as const,
        hint: hasOwn(config, 'API_ENDPOINT')
          ? config.API_ENDPOINT
          : i18n.t('(not set)'),
      },
      {
        label: i18n.t('Model'),
        value: 'MODEL' as const,
        hint: hasOwn(config, 'MODEL') ? config.MODEL : i18n.t('(not set)'),
      },
      {
        label: i18n.t('Silent Mode'),
        value: 'SILENT_MODE' as const,
        hint: hasOwn(config, 'SILENT_MODE')
          ? config.SILENT_MODE.toString()
          : i18n.t('(not set)'),
      },
      {
        label: i18n.t('Language'),
        value: 'LANGUAGE' as const,
        hint: hasOwn(config, 'LANGUAGE')
          ? config.LANGUAGE
          : i18n.t('(not set)'),
      },
      {
        label: i18n.t('Cancel'),
        value: 'cancel' as const,
        hint: i18n.t('Exit the program'),
      },
    ];

    const choice = (await p.select({
      message: i18n.t('Set config') + ':',
      options,
    })) as ConfigKeys | 'cancel' | symbol;

    if (p.isCancel(choice)) return;

    if (choice === 'PROVIDER') {
      const provider = (await p.select({
        message: i18n.t('Select AI provider'),
        options: [
          { value: 'openai', label: 'API Provider (OpenAI, etc.)' },
          { value: 'local', label: 'Local Models (Ollama, etc.)' },
        ],
      })) as string;
      if (p.isCancel(provider)) return;
      await setConfigs([['PROVIDER', provider]]);
      // Update endpoint and model to defaults for the new provider
      if (provider === 'openai') {
        await setConfigs([
          ['API_ENDPOINT', 'https://api.openai.com/v1'],
          ['MODEL', 'gpt-4o-mini']
        ]);
      } else if (provider === 'local') {
        await setConfigs([
          ['API_ENDPOINT', 'http://localhost:11434'],
          ['MODEL', 'llama2']
        ]);
      }
    } else if (choice === 'API_KEY') {
      const key = await p.text({
        message: i18n.t('Enter your API key'),
        validate: (value) => {
          if (!value.length) {
            return i18n.t('Please enter a key');
          }
        },
      });
      if (p.isCancel(key)) return;
      await setConfigs([['API_KEY', key]]);
    } else if (choice === 'API_ENDPOINT') {
      const apiEndpoint = await p.text({
        message: i18n.t('Enter your API endpoint'),
        placeholder: config.PROVIDER === 'local' ? 'http://localhost:11434' : 'https://api.openai.com/v1',
      });
      if (p.isCancel(apiEndpoint)) return;
      await setConfigs([['API_ENDPOINT', apiEndpoint]]);
    } else if (choice === 'MODEL') {
      const { API_KEY: key, API_ENDPOINT: apiEndpoint, PROVIDER: provider } =
        await getConfig();
      const models = await getModels(key, apiEndpoint, provider);
      const model = (await p.select({
        message: 'Pick a model.',
        options: [
          ...models.map((m: Model) => ({ value: m.id, label: m.id })),
          { value: '__custom__', label: 'Enter custom model name' },
        ],
      })) as string;
      if (p.isCancel(model)) return;
      let finalModel = model;
      if (model === '__custom__') {
        const customModel = await p.text({
          message: i18n.t('Enter your custom model name'),
        });
        if (p.isCancel(customModel)) return;
        finalModel = customModel;
      }
      await setConfigs([['MODEL', finalModel]]);
    } else if (choice === 'SILENT_MODE') {
      const silentMode = await p.confirm({
        message: i18n.t('Enable silent mode?'),
      });
      if (p.isCancel(silentMode)) return;
      await setConfigs([['SILENT_MODE', silentMode ? 'true' : 'false']]);
    } else if (choice === 'LANGUAGE') {
      const language = (await p.select({
        message: i18n.t('Enter the language you want to use'),
        options: languagesOptions,
      })) as string;
      if (p.isCancel(language)) return;
      await setConfigs([['LANGUAGE', language]]);
      i18n.setLanguage(language);
    }
    if (choice === 'cancel') return;
    showConfigUI();
  } catch (error: any) {
    console.error(`\n${red('✖')} ${error.message}`);
    handleCliError(error);
    process.exit(1);
  }
};
