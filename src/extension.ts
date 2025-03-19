import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Disposable } from 'vscode';

/**
 * Theme type enumeration
 * @readonly
 * @enum {string}
 */
enum ThemeType {
  LIGHT = 'light',
  DARK = 'dark'
}

/**
 * Extension configuration interface
 * @interface
 */
interface IExtensionConfiguration {
  /** User-defined color overrides */
  readonly colorOverrides: ReadonlyMap<string, string>;

  /** Additional debug output verbosity */
  readonly debugMode: boolean;

  /** Enable experimental UI color mappings */
  readonly experimentalUiColors: boolean;
}

/**
 * Theme definition interface
 * @interface
 */
interface IThemeDefinition {
  /** Unique identifier for the theme */
  readonly id: string;

  /** Display name for the theme */
  readonly name: string;

  /** Light or dark theme */
  readonly type: ThemeType;

  /** Path to source file relative to extension root */
  readonly sourceFile: string;

  /** Theme description for UI presentation */
  readonly description: string;
}

/**
 * Color palette interface
 * @interface
 */
interface IColorPalette {
  /** Direct color mappings (e.g., "blue-intense" -> "#0000FF") */
  readonly colors: ReadonlyMap<string, string>;

  /** Semantic mappings (e.g., "keyword" -> "magenta-cooler") */
  readonly semantics: ReadonlyMap<string, string>;
}

/**
 * Token definition interface
 * @interface
 */
interface ITokenStyle {
  /** TextMate scope selectors */
  readonly scope: readonly string[] | string;

  /** Token style settings */
  readonly settings: {
    /** Foreground color as hex */
    readonly foreground?: string;

    /** Font styling (bold, italic, etc) */
    readonly fontStyle?: string;

    /** Background color as hex (rarely used) */
    readonly background?: string;
  };
}

/**
 * VS Code theme output interface
 * @interface
 */
interface IVSCodeTheme {
  /** Theme display name */
  readonly name: string;

  /** Light or dark theme type */
  readonly type: ThemeType;

  /** UI color definitions */
  readonly colors: Readonly<Record<string, string>>;

  /** Syntax token styling */
  readonly tokenColors: readonly ITokenStyle[];

  /** Semantic token color customizations (optional) */
  readonly semanticTokenColors?: Readonly<Record<string, string | ITokenStyle['settings']>>;
}

/**
 * Base theme service interface
 * @interface
 */
interface IThemeService {
  /**
   * Generate theme files from source definitions
   * @param extensionPath - Path to the extension
   * @param config - User configuration
   * @returns Promise that resolves when generation is complete
   */
  generateThemes(extensionPath: string, config: IExtensionConfiguration): Promise<void>;
}

/**
 * Theme parser interface
 * @interface
 */
interface IThemeParser {
  /**
   * Parse a theme file into a color palette
   * @param filePath - Path to the theme file
   * @returns Promise resolving to the parsed color palette
   */
  parseThemeFile(filePath: string): Promise<IColorPalette>;

  /**
   * Apply overrides to a color palette
   * @param palette - Original color palette
   * @param overrides - User-defined overrides
   * @returns New palette with overrides applied
   */
  applyOverrides(palette: IColorPalette, overrides: ReadonlyMap<string, string>): IColorPalette;

  /**
   * Resolve a color name to its actual hex value
   * @param name - Color name to resolve
   * @param palette - Palette to resolve against
   * @returns Resolved hex color or undefined if not found
   */
  resolveColor(name: string, palette: IColorPalette): string | undefined;
}

/**
 * Theme generator interface
 * @interface
 */
interface IThemeGenerator {
  /**
   * Generate a VS Code theme from a color palette
   * @param palette - Color palette to use
   * @param definition - Theme definition
   * @param config - User configuration
   * @returns Complete VS Code theme
   */
  generateTheme(palette: IColorPalette, definition: IThemeDefinition, config: IExtensionConfiguration): IVSCodeTheme;
}

/**
 * Configuration service interface
 * @interface
 */
interface IConfigurationService {
  /**
   * Get current configuration
   * @returns Current configuration object
   */
  getConfiguration(): IExtensionConfiguration;

  /**
   * Register a handler for configuration changes
   * @param handler - Callback to invoke when configuration changes
   * @returns Disposable to unregister the handler
   */
  onConfigurationChanged(handler: (config: IExtensionConfiguration) => void): Disposable;
}

/**
 * Logger interface
 * @interface
 */
interface ILogger {
  /**
   * Log informational message
   * @param message - Message to log
   */
  info(message: string): void;

  /**
   * Log debug message (only in debug mode)
   * @param message - Message to log
   */
  debug(message: string): void;

  /**
   * Log warning message
   * @param message - Warning message
   */
  warn(message: string): void;

  /**
   * Log error message
   * @param message - Error message
   * @param error - Optional error object
   */
  error(message: string, error?: unknown): void;

  /**
   * Show the log to the user
   */
  show(): void;
}

/**
 * Base error class for the extension
 * @extends Error
 */
class ModusThemeError extends Error {
  /** Error code for categorization */
  public readonly code: string;

  /** Original error if this is a wrapper */
  public readonly cause?: Error;

  /**
   * Create a new ModusThemeError
   * @param message - Error message
   * @param code - Error code
   * @param cause - Original error if applicable
   */
  constructor(message: string, code: string, cause?: Error) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.cause = cause;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error thrown when theme parsing fails
 * @extends ModusThemeError
 */
class ThemeParseError extends ModusThemeError {
  /**
   * Create a new ThemeParseError
   * @param message - Error message
   * @param cause - Original error if applicable
   */
  constructor(message: string, cause?: Error) {
    super(message, 'THEME_PARSE_ERROR', cause);
  }
}

/**
 * Error thrown when theme generation fails
 * @extends ModusThemeError
 */
class ThemeGenerationError extends ModusThemeError {
  /**
   * Create a new ThemeGenerationError
   * @param message - Error message
   * @param cause - Original error if applicable
   */
  constructor(message: string, cause?: Error) {
    super(message, 'THEME_GENERATION_ERROR', cause);
  }
}

/**
 * Error thrown when file operations fail
 * @extends ModusThemeError
 */
class FileOperationError extends ModusThemeError {
  /**
   * Create a new FileOperationError
   * @param message - Error message
   * @param cause - Original error if applicable
   */
  constructor(message: string, cause?: Error) {
    super(message, 'FILE_OPERATION_ERROR', cause);
  }
}

/**
 * Error thrown for configuration issues
 * @extends ModusThemeError
 */
class ConfigurationError extends ModusThemeError {
  /**
   * Create a new ConfigurationError
   * @param message - Error message
   * @param cause - Original error if applicable
   */
  constructor(message: string, cause?: Error) {
    super(message, 'CONFIGURATION_ERROR', cause);
  }
}

/**
 * Validation utilities
 */
class Validator {
  /**
   * Ensure a value is not null or undefined
   * @param value - Value to check
   * @param name - Name for error message
   * @throws Error if value is null or undefined
   * @returns The original value
   */
  static required<T>(value: T | null | undefined, name: string): T {
    if (value === null || value === undefined) {
      throw new Error(`${name} is required but was ${value}`);
    }
    return value;
  }

  /**
   * Ensure a string is not empty
   * @param value - String to check
   * @param name - Name for error message
   * @throws Error if string is empty
   * @returns The original string
   */
  static notEmpty(value: string, name: string): string {
    if (!value) {
      throw new Error(`${name} cannot be empty`);
    }
    return value;
  }

  /**
   * Validate a hex color string
   * @param value - Color to validate
   * @param name - Name for error message
   * @throws Error if not a valid hex color
   * @returns The validated color
   */
  static hexColor(value: string, name: string): string {
    if (!/^#[0-9A-Fa-f]{6}$/.test(value)) {
      throw new Error(`${name} must be a valid hex color (e.g. #FF0000), got ${value}`);
    }
    return value;
  }

  /**
   * Validate a theme definition
   * @param def - Theme definition to validate
   * @throws Error if definition is invalid
   * @returns The validated definition
   */
  static themeDefinition(def: IThemeDefinition): IThemeDefinition {
    this.required(def, 'Theme definition');
    this.notEmpty(def.id, 'Theme ID');
    this.notEmpty(def.name, 'Theme name');
    this.notEmpty(def.sourceFile, 'Theme source file');

    if (def.type !== ThemeType.LIGHT && def.type !== ThemeType.DARK) {
      throw new Error(`Theme type must be '${ThemeType.LIGHT}' or '${ThemeType.DARK}', got '${def.type}'`);
    }

    return def;
  }
}

/**
 * Logger implementation
 * @implements ILogger
 */
class Logger implements ILogger {
  private static instance: Logger;
  private outputChannel: vscode.OutputChannel | null = null;
  private debugEnabled = false;

  /**
   * Create a new Logger
   * @private
   */
  private constructor() {
    // Defer creating the output channel until needed
  }

  /**
   * Get the logger instance (singleton pattern)
   * @returns Logger instance
   */
  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * Set debug mode
   * @param enabled - Whether debug logging is enabled
   */
  public setDebugMode(enabled: boolean): void {
    this.debugEnabled = enabled;
  }

  /**
   * Ensure the output channel is initialized
   * @private
   */
  private ensureOutputChannel(): vscode.OutputChannel {
    if (!this.outputChannel) {
      this.outputChannel = vscode.window.createOutputChannel('Modus Themes');
    }
    return this.outputChannel;
  }

  /**
   * @inheritdoc
   */
  public info(message: string): void {
    this.ensureOutputChannel().appendLine(`[INFO] ${this.getTimestamp()} ${message}`);
  }

  /**
   * @inheritdoc
   */
  public debug(message: string): void {
    if (this.debugEnabled) {
      this.ensureOutputChannel().appendLine(`[DEBUG] ${this.getTimestamp()} ${message}`);
    }
  }

  /**
   * @inheritdoc
   */
  public warn(message: string): void {
    this.ensureOutputChannel().appendLine(`[WARN] ${this.getTimestamp()} ${message}`);
  }

  /**
   * @inheritdoc
   */
  public error(message: string, error?: unknown): void {
    this.ensureOutputChannel().appendLine(`[ERROR] ${this.getTimestamp()} ${message}`);
    if (error) {
      if (error instanceof ModusThemeError) {
        this.ensureOutputChannel().appendLine(`  Code: ${error.code}`);
        this.ensureOutputChannel().appendLine(`  Message: ${error.message}`);
        if (error.cause) {
          this.ensureOutputChannel().appendLine(`  Cause: ${error.cause.message}`);
          if (error.cause.stack) {
            this.ensureOutputChannel().appendLine(`  Stack: ${error.cause.stack}`);
          }
        }
      } else if (error instanceof Error) {
        this.ensureOutputChannel().appendLine(`  ${error.message}`);
        if (error.stack) {
          this.ensureOutputChannel().appendLine(`  ${error.stack}`);
        }
      } else {
        this.ensureOutputChannel().appendLine(`  ${String(error)}`);
      }
    }
  }

  /**
   * @inheritdoc
   */
  public show(): void {
    this.ensureOutputChannel().show();
  }

  /**
   * Get a timestamp for logging
   * @private
   * @returns Formatted timestamp
   */
  private getTimestamp(): string {
    const now = new Date();
    return now.toISOString();
  }
}

/**
 * Configuration service implementation
 * @implements IConfigurationService
 */
class ConfigurationService implements IConfigurationService {
  private static instance: ConfigurationService;

  /**
   * Create a new ConfigurationService instance
   * @private
   */
  private constructor() { }

  /**
   * Get the configuration service instance (singleton pattern)
   * @returns ConfigurationService instance
   */
  public static getInstance(): ConfigurationService {
    if (!ConfigurationService.instance) {
      ConfigurationService.instance = new ConfigurationService();
    }
    return ConfigurationService.instance;
  }

  /**
   * @inheritdoc
   */
  public getConfiguration(): IExtensionConfiguration {
    try {
      const config = vscode.workspace.getConfiguration('modus');
      const debugMode = config.get<boolean>('debugMode', false);
      const experimentalUiColors = config.get<boolean>('experimentalUiColors', false);
      const overrides = config.get<Record<string, string>>('colorOverrides', {});
      const colorOverrides = new Map<string, string>();

      for (const [key, value] of Object.entries(overrides)) {
        colorOverrides.set(key, value);
      }

      return {
        colorOverrides,
        debugMode,
        experimentalUiColors
      };
    } catch (error) {
      throw new ConfigurationError('Failed to load configuration', error instanceof Error ? error : undefined);
    }
  }

  /**
   * @inheritdoc
   */
  public onConfigurationChanged(handler: (config: IExtensionConfiguration) => void): Disposable {
    return vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('modus')) {
        try {
          const newConfig = this.getConfiguration();
          handler(newConfig);
        } catch (error) {
          Logger.getInstance().error('Error handling configuration change', error);
        }
      }
    });
  }
}

/**
 * Theme parser implementation
 * @implements IThemeParser
 */
class ThemeParser implements IThemeParser {
  private static instance: ThemeParser;
  private readonly logger: ILogger;

  /**
   * Create a new ThemeParser
   * @private
   */
  private constructor() {
    this.logger = Logger.getInstance();
  }

  /**
   * Get the parser instance (singleton pattern)
   * @returns ThemeParser instance
   */
  public static getInstance(): ThemeParser {
    if (!ThemeParser.instance) {
      ThemeParser.instance = new ThemeParser();
    }
    return ThemeParser.instance;
  }

  /**
   * @inheritdoc
   */
  public async parseThemeFile(filePath: string): Promise<IColorPalette> {
    try {
      Validator.notEmpty(filePath, 'File path');

      let content: string;
      try {
        content = await fs.readFile(filePath, 'utf8');
      } catch (error) {
        throw new FileOperationError(`Failed to read theme file: ${filePath}`,
          error instanceof Error ? error : undefined);
      }

      const colors = new Map<string, string>();
      const semantics = new Map<string, string>();

      // Helper lambda for extracting regex matches
      //
      const parse = (r: RegExp, matcher: (m: RegExpExecArray) => void): void => {
        let m: RegExpExecArray | null;
        while ((m = r.exec(content)) !== null) {
          matcher(m);
        }
      };

      // (color-name "#RRGGBB")
      //
      parse(
        /\(([a-zA-Z0-9-]+)\s+"(#[0-9a-fA-F]{6})"\)/g,
        (m) => colors.set(m[1], m[2])
      );

      // (semantic-name color-name)
      //
      parse(
        /\(([a-zA-Z0-9-]+)\s+(?!#)([a-zA-Z0-9-]+)\)/g,
        (m) => semantics.set(m[1], m[2])
      );

      if (colors.size === 0) {
        throw new ThemeParseError(`No colors found in theme file: ${filePath}`);
      }

      this.logger.debug(`Parsed palette: ${colors.size} colors, ${semantics.size} semantic mappings`);

      return Object.freeze({
        colors: Object.freeze(colors),
        semantics: Object.freeze(semantics)
      });
    } catch (error) {
      if (error instanceof ModusThemeError) {
        throw error;
      }
      throw new ThemeParseError(
        `Failed to parse theme file: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * @inheritdoc
   */
  public applyOverrides(palette: IColorPalette, overrides: ReadonlyMap<string, string>): IColorPalette {
    try {
      Validator.required(palette, 'Color palette');
      Validator.required(overrides, 'Overrides map');

      const colors = new Map(palette.colors);
      const semantics = new Map(palette.semantics);

      for (const [key, value] of overrides.entries()) {
        Validator.notEmpty(key, 'Override key');
        Validator.notEmpty(value, 'Override value');

        if (value.startsWith('#')) {
          try {
            Validator.hexColor(value, `Override for ${key}`);
            colors.set(key, value);
            this.logger.debug(`Applied color override: ${key} -> ${value}`);
          } catch (error) {
            this.logger.warn(`Skipping invalid color override: ${key}=${value}`);
          }
        } else {
          semantics.set(key, value);
          this.logger.debug(`Applied semantic override: ${key} -> ${value}`);
        }
      }

      return Object.freeze({
        colors: Object.freeze(colors),
        semantics: Object.freeze(semantics)
      });
    } catch (error) {
      if (error instanceof ModusThemeError) {
        throw error;
      }
      throw new ThemeParseError(
        `Failed to apply overrides: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * @inheritdoc
   */
  public resolveColor(name: string, palette: IColorPalette): string | undefined {
    try {
      Validator.notEmpty(name, 'Color name');
      Validator.required(palette, 'Color palette');

      if (palette.colors.has(name)) {
        return palette.colors.get(name);
      }

      // Follow semantic mappings (with cycle detection)
      //
      const visited = new Set<string>();
      let current = name;

      while (palette.semantics.has(current) && !visited.has(current)) {
        visited.add(current);
        current = palette.semantics.get(current)!;

        if (palette.colors.has(current)) {
          return palette.colors.get(current);
        }
      }

      return undefined;
    } catch (error) {
      this.logger.debug(`Error resolving color ${name}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }
}

/**
 * TextMate scope mappings for syntax highlighting
 *
 * Tokens auto-generated from
 * https://code.visualstudio.com/api/language-extensions/semantic-highlight-guide#standard-token-types-and-modifiers
 *
 * @const
 * @readonly
 */
const TEXTMATE: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'comment': Object.freeze(['comment']),
  'string':  Object.freeze(['string']),
  'keyword': Object.freeze(['keyword']),
});

/**
 * VS Code UI color mappings
 *
 * Tokens auto-generated from
 * https://code.visualstudio.com/api/references/theme-color
 *
 * NOTE: Values are currently placeholders and need to be updated.
 *
 * @const
 * @readonly
 */
const EDITOR: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // Text colors
  //

  // Action colors
  //

  // Button control
  //

  // Dropdown control
  //

  // Input control
  //

  // Scrollbar control
  //

  // Badge
  //

  // Progress bar
  //

  // Lists and trees
  //

  // Activity Bar
  //

  // Profiles
  //

  // Side Bar
  //

  // Minimap
  //

  // Editor Groups & Tabs
  //

  // Editor colors
  //
  'editor.background': Object.freeze(['bg-main']),
  'editor.foreground': Object.freeze(['fg-main']),

  // Diff editor colors
  //

  // Chat colors
  //

  // Inline Chat colors
  //

  // Panel Chat colors
  //

  // Editor widget colors
  //

  // Peek view colors
  //

  // Merge conflicts colors
  //

  // Panel colors
  //

  // Status Bar colors
  //

  // Title Bar colors
  //

  // Menu Bar colors
  //

  // Command Center colors
  //

  // Notification colors
  //

  // Banner colors
  //

  // Extensions colors
  //

  // Quick picker colors
  //

  // Keybinding label colors
  //

  // Keyboard shortcut table colors
  //

  // Integrated Terminal colors
  //

  // Debug colors
  //

  // Testing colors
  //

  // Welcome page colors
  //

  // Git colors
  //

  // Source Control Graph colors
  //

  // Settings Editor colors
  //

  // Breadcrumbs colors
  //

  // Snippets colors
  //

  // Symbol Icons colors
  //

  // Debug Icons colors
  //

  // Notebook colors
  //

  // Chart colors
  //

  // Ports colors
  //

  // Comments View colors
  //

  // Action Bar colors
  //

  // Simple Find Widget colors
  //

  // Gauge colors
  //

  // Extension colors
  //
});

/**
 * Experimental UI mappings.
 *
 * This is highly experimental, and everything is subject to change. Expect
 * potential issues such as incorrect contrast, color mismatches, and other
 * visual inconsistencies. Use it only if you're willing to contribute or can
 * tolerate any problems that may arise.
 *
 * @const
 * @readonly
 */
const EDITOR_DEVEL: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // Text colors
  //

  // Action colors
  //

  // Button control
  //

  // Dropdown control
  //

  // Input control
  //

  // Scrollbar control
  //

  // Badge
  //

  // Progress bar
  //

  // Lists and trees
  //

  // Activity Bar
  //

  // Profiles
  //

  // Side Bar
  //

  // Minimap
  //

  // Editor Groups & Tabs
  //

  // Editor colors
  //

  // Diff editor colors
  //

  // Chat colors
  //

  // Inline Chat colors
  //

  // Panel Chat colors
  //

  // Editor widget colors
  //

  // Peek view colors
  //

  // Merge conflicts colors
  //

  // Panel colors
  //

  // Status Bar colors
  //

  // Title Bar colors
  //
  'titleBar.activeBackground': Object.freeze(['bg-main']),

  // Menu Bar colors
  //

  // Command Center colors
  //

  // Notification colors
  //

  // Banner colors
  //

  // Extensions colors
  //

  // Quick picker colors
  //

  // Keybinding label colors
  //

  // Keyboard shortcut table colors
  //

  // Integrated Terminal colors
  //

  // Debug colors
  //

  // Testing colors
  //

  // Welcome page colors
  //

  // Git colors
  //

  // Source Control Graph colors
  //

  // Settings Editor colors
  //

  // Breadcrumbs colors
  //

  // Snippets colors
  //

  // Symbol Icons colors
  //

  // Debug Icons colors
  //

  // Notebook colors
  //

  // Chart colors
  //

  // Ports colors
  //

  // Comments View colors
  //

  // Action Bar colors
  //

  // Simple Find Widget colors
  //

  // Gauge colors
  //

  // Extension colors
  //
});

/**
 * Semantic token mappings
 *
 * Tokens auto-generated from
 * https://code.visualstudio.com/api/language-extensions/semantic-highlight-guide#standard-token-types-and-modifiers
 *
 * @const
 * @readonly
 */
const SEMANTIC: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'namespace':      Object.freeze(['']),
  'class':          Object.freeze(['']),
  'enum':           Object.freeze(['']),
  'interface':      Object.freeze(['']),
  'struct':         Object.freeze(['']),
  'typeParameter':  Object.freeze(['']),
  'type':           Object.freeze(['type']),
  'parameter':      Object.freeze(['']),
  'variable':       Object.freeze(['variable']),
  'property':       Object.freeze(['']),
  'enumMember':     Object.freeze(['']),
  'decorator':      Object.freeze(['']),
  'event':          Object.freeze(['']),
  'function':       Object.freeze(['fnname']),
  'method':         Object.freeze(['fnname']), // NOTE: Same as function
  'macro':          Object.freeze(['']),
  'label':          Object.freeze(['']),
  'comment':        Object.freeze(['comment']),
  'string':         Object.freeze(['string']),
  'keyword':        Object.freeze(['keyword']),
  'number':         Object.freeze(['number']),
  'regexp':         Object.freeze(['rx-construct']),
  'operator':       Object.freeze(['operator']),
});

/**
 * Theme definitions
 * @const
 * @readonly
 */
const THEME_DEFINITIONS: readonly IThemeDefinition[] = Object.freeze([
  Object.freeze({
    id: 'modus-operandi',
    name: 'Modus Operandi',
    type: ThemeType.LIGHT,
    sourceFile: 'upstream/modus-operandi-theme.el',
    description: 'Elegant, highly legible theme with a white background'
  }),
  Object.freeze({
    id: 'modus-vivendi',
    name: 'Modus Vivendi',
    type: ThemeType.DARK,
    sourceFile: 'upstream/modus-vivendi-theme.el',
    description: 'Elegant, highly legible theme with a black background'
  }),
  Object.freeze({
    id: 'modus-operandi-tinted',
    name: 'Modus Operandi Tinted',
    type: ThemeType.LIGHT,
    sourceFile: 'upstream/modus-operandi-tinted-theme.el',
    description: 'Light theme with a subtle cream tint (warm appearance)'
  }),
  Object.freeze({
    id: 'modus-vivendi-tinted',
    name: 'Modus Vivendi Tinted',
    type: ThemeType.DARK,
    sourceFile: 'upstream/modus-vivendi-tinted-theme.el',
    description: 'Dark theme with a subtle blue tint (night sky appearance)'
  }),
  Object.freeze({
    id: 'modus-operandi-deuteranopia',
    name: 'Modus Operandi Deuteranopia',
    type: ThemeType.LIGHT,
    sourceFile: 'upstream/modus-operandi-deuteranopia-theme.el',
    description: 'Deuteranopia-optimized light theme for red-green color deficiency'
  }),
  Object.freeze({
    id: 'modus-vivendi-deuteranopia',
    name: 'Modus Vivendi Deuteranopia',
    type: ThemeType.DARK,
    sourceFile: 'upstream/modus-vivendi-deuteranopia-theme.el',
    description: 'Deuteranopia-optimized dark theme for red-green color deficiency'
  }),
  Object.freeze({
    id: 'modus-operandi-tritanopia',
    name: 'Modus Operandi Tritanopia',
    type: ThemeType.LIGHT,
    sourceFile: 'upstream/modus-operandi-tritanopia-theme.el',
    description: 'Tritanopia-optimized light theme for blue-yellow color deficiency'
  }),
  Object.freeze({
    id: 'modus-vivendi-tritanopia',
    name: 'Modus Vivendi Tritanopia',
    type: ThemeType.DARK,
    sourceFile: 'upstream/modus-vivendi-tritanopia-theme.el',
    description: 'Tritanopia-optimized dark theme for blue-yellow color deficiency'
  }),
]);

/**
 * Theme generator implementation
 * @implements IThemeGenerator
 */
class ThemeGenerator implements IThemeGenerator {
  private static instance: ThemeGenerator;
  private readonly logger: ILogger;
  private readonly parser: IThemeParser;

  /**
   * Theme-specific overrides for syntax tokens
   * @private
   * @readonly
   */
  private readonly overrides: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
    // Semantic tokens
  });

  /**
   * Create a new ThemeGenerator
   * @private
   */
  private constructor() {
    this.logger = Logger.getInstance();
    this.parser = ThemeParser.getInstance();
  }

  /**
   * Get the generator instance (singleton pattern)
   * @returns ThemeGenerator instance
   */
  public static getInstance(): ThemeGenerator {
    if (!ThemeGenerator.instance) {
      ThemeGenerator.instance = new ThemeGenerator();
    }
    return ThemeGenerator.instance;
  }

  /**
   * @inheritdoc
   */
  public generateTheme(
    palette: IColorPalette,
    definition: IThemeDefinition,
    config: IExtensionConfiguration
  ): IVSCodeTheme {
    try {
      Validator.required(palette, 'Color palette');
      Validator.themeDefinition(definition);
      Validator.required(config, 'Configuration');

      const { id, name, type } = definition;

      const getColor = (colorName: string): string => {
        const resolvedColor = this.parser.resolveColor(colorName, palette);
        if (!resolvedColor) {
          throw new ThemeGenerationError(`Missing color: ${colorName} in theme ${id}`);
        }
        return resolvedColor;
      };

      const colors: Record<string, string> = {};

      for (const [vscodeId, modusColors] of Object.entries(EDITOR)) {
        if (modusColors.length > 0 && modusColors[0] !== '') {
          colors[vscodeId] = getColor(modusColors[0]);
        }
      }

      if (config.experimentalUiColors) {
        for (const [vscodeId, modusColors] of Object.entries(EDITOR_DEVEL)) {
          if (modusColors.length > 0 && modusColors[0] !== '') {
            colors[vscodeId] = getColor(modusColors[0]);
          }
        }
      }

      const tokenColors: ITokenStyle[] = [];
      this.processTextMateTokens(tokenColors, palette, id, getColor);
      const semanticTokenColors: Record<string, string | ITokenStyle['settings']> = {};
      this.processSemanticTokens(semanticTokenColors, palette, id, getColor);

      this.logger.info(`Generated theme: ${name}${config.experimentalUiColors ? ' (with experimental UI colors)' : ''}`);

      return Object.freeze({
        name,
        type,
        colors: Object.freeze(colors),
        tokenColors: Object.freeze(tokenColors),
        semanticTokenColors: Object.freeze(semanticTokenColors)
      });
    } catch (error) {
      if (error instanceof ModusThemeError) {
        throw error;
      }
      throw new ThemeGenerationError(
        `Failed to generate theme: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Process TextMate tokens with theme-specific overrides
   * @private
   * @param tokenColors - Token colors array to append to
   * @param palette - Color palette
   * @param themeId - Theme identifier
   * @param getColor - Function to resolve colors
   */
  private processTextMateTokens(
    tokenColors: ITokenStyle[],
    palette: IColorPalette,
    themeId: string,
    getColor: (name: string) => string
  ): void {
    const scopesByColor = new Map<string, string[]>();

    for (const [scope, colorNames] of Object.entries(TEXTMATE)) {
      const overrides = this.overrides[scope];
      let colorName: string;

      if (overrides && overrides[themeId]) {
        colorName = overrides[themeId];
      } else if (colorNames.length > 0 && colorNames[0] !== '') {
        colorName = colorNames[0];
      } else {
        continue;
      }

      if (!scopesByColor.has(colorName)) {
        scopesByColor.set(colorName, []);
      }
      scopesByColor.get(colorName)!.push(scope);
    }

    for (const [colorName, scopes] of scopesByColor.entries()) {
      tokenColors.push({
        scope: scopes,
        settings: {
          foreground: getColor(colorName)
        }
      });
    }
  }

  /**
   * Process semantic tokens with theme-specific overrides
   * @private
   * @param semanticTokenColors - Semantic token colors record to populate
   * @param palette - Color palette
   * @param themeId - Theme identifier
   * @param getColor - Function to resolve colors
   */
  private processSemanticTokens(
    semanticTokenColors: Record<string, string | ITokenStyle['settings']>,
    palette: IColorPalette,
    themeId: string,
    getColor: (name: string) => string
  ): void {
    for (const [token, colorNames] of Object.entries(SEMANTIC)) {
      const overrides = this.overrides[token];
      let colorName: string;

      if (overrides && overrides[themeId]) {
        colorName = overrides[themeId];
      } else if (colorNames.length > 0 && colorNames[0] !== '') {
        colorName = colorNames[0];
      } else {
        continue;
      }

      semanticTokenColors[token] = getColor(colorName);
    }
  }
}

/**
 * Theme service implementation
 * @implements IThemeService
 */
class ThemeService implements IThemeService {
  private static instance: ThemeService;
  private readonly logger: ILogger;
  private readonly parser: IThemeParser;
  private readonly generator: IThemeGenerator;

  /**
   * Create a new ThemeService
   * @private
   */
  private constructor() {
    this.logger = Logger.getInstance();
    this.parser = ThemeParser.getInstance();
    this.generator = ThemeGenerator.getInstance();
  }

  /**
   * Get the theme service instance (singleton pattern)
   * @returns ThemeService instance
   */
  public static getInstance(): ThemeService {
    if (!ThemeService.instance) {
      ThemeService.instance = new ThemeService();
    }
    return ThemeService.instance;
  }

  /**
   * @inheritdoc
   */
  public async generateThemes(extensionPath: string, config: IExtensionConfiguration): Promise<void> {
    try {
      Validator.notEmpty(extensionPath, 'Extension path');
      Validator.required(config, 'Configuration');

      const themesDir = path.join(extensionPath, 'themes');
      try {
        await fs.mkdir(themesDir, { recursive: true });
      } catch (error) {
        throw new FileOperationError(
          `Failed to create themes directory: ${themesDir}`,
          error instanceof Error ? error : undefined
        );
      }

      const results = await Promise.allSettled(
        THEME_DEFINITIONS.map(async (themeDef) => {
          try {
            const sourcePath = path.join(extensionPath, themeDef.sourceFile);
            const outputPath = path.join(themesDir, `${themeDef.id}-color-theme.json`);

            this.logger.debug(`Parsing theme file: ${sourcePath}`);
            const palette = await this.parser.parseThemeFile(sourcePath);

            this.logger.debug(`Applying overrides to theme: ${themeDef.id}`);
            const finalPalette = this.parser.applyOverrides(palette, config.colorOverrides);

            this.logger.debug(`Generating theme: ${themeDef.id}`);
            const theme = this.generator.generateTheme(finalPalette, themeDef, config);

            this.logger.debug(`Writing theme file: ${outputPath}`);
            await fs.writeFile(outputPath, JSON.stringify(theme, null, 2));

            this.logger.info(`Generated theme file: ${themeDef.name}`);
            return themeDef.id;
          } catch (error) {
            this.logger.error(`Failed to generate theme ${themeDef.id}`, error);
            throw error;
          }
        })
      );

      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      this.logger.info(`Theme generation complete: ${succeeded} succeeded, ${failed} failed`);

      if (failed > 0) {
        throw new ThemeGenerationError(`Failed to generate ${failed} theme(s)`);
      }
    } catch (error) {
      if (error instanceof ModusThemeError) {
        throw error;
      }
      throw new ThemeGenerationError(
        `Failed to generate themes: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }
}

/**
 * Main extension class
 */
class ModusThemesExtension {
  private readonly context: vscode.ExtensionContext;
  private readonly logger: ILogger;
  private readonly configService: IConfigurationService;
  private readonly themeService: IThemeService;
  private readonly disposables: vscode.Disposable[] = [];

  /**
   * Create a new ModusThemesExtension
   * @param context - Extension context
   */
  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.logger = Logger.getInstance();
    this.configService = ConfigurationService.getInstance();
    this.themeService = ThemeService.getInstance();
  }

  /**
   * Activate the extension
   * @returns Promise resolving when activation is complete
   */
  public async activate(): Promise<void> {
    try {
      this.logger.info('Modus Themes extension activating');

      const config = this.configService.getConfiguration();

      (this.logger as Logger).setDebugMode(config.debugMode);

      this.logger.debug('Generating initial themes');
      await this.themeService.generateThemes(this.context.extensionPath, config);

      this.disposables.push(
        this.configService.onConfigurationChanged(async (newConfig) => {
          try {
            (this.logger as Logger).setDebugMode(newConfig.debugMode);

            this.logger.debug('Configuration changed, regenerating themes');
            await this.themeService.generateThemes(this.context.extensionPath, newConfig);

            vscode.window.showInformationMessage(
              'Modus Themes: Theme files have been updated. Reload window to apply changes.',
              'Reload Window'
            ).then(selection => {
              if (selection === 'Reload Window') {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
              }
            });
          } catch (error) {
            this.logger.error('Failed to update themes after configuration change', error);
            vscode.window.showErrorMessage(
              'Modus Themes: Failed to update theme files. Check the output panel for details.'
            );
            this.logger.show();
          }
        })
      );

      this.disposables.push(
        vscode.commands.registerCommand('modus.reloadWindow', () => {
          vscode.commands.executeCommand('workbench.action.reloadWindow');
        })
      );

      this.logger.info('Modus Themes extension successfully activated');
    } catch (error) {
      this.logger.error('Failed to activate Modus Themes extension', error);
      vscode.window.showErrorMessage(
        'Failed to activate Modus Themes extension. Check the output panel for details.'
      );
      this.logger.show();
      throw error;
    }
  }

  /**
   * Deactivate the extension
   */
  public deactivate(): void {
    this.logger.info('Modus Themes extension deactivating');

    for (const disposable of this.disposables) {
      disposable.dispose();
    }

    this.logger.info('Modus Themes extension deactivated');
  }
}

/**
 * Extension activation function called by VS Code
 * @param context - Extension context
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const extension = new ModusThemesExtension(context);
  await extension.activate();
}

/**
 * Extension deactivation function called by VS Code
 */
export function deactivate(): void {
  // Extension cleanup will be handled by the ModusThemesExtension class
}
