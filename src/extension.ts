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
  /** Controls whether keywords use bold styling */
  readonly boldKeywords: boolean;

  /** Controls whether comments use italic styling */
  readonly italicComments: boolean;

  /** User-defined color overrides */
  readonly colorOverrides: ReadonlyMap<string, string>;

  /** Controls whether semantic highlighting is enabled */
  readonly useSemanticHighlighting: boolean;

  /** Additional debug output verbosity */
  readonly debugMode: boolean;
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

  /** Whether to use semantic token highlighting */
  readonly semanticHighlighting: boolean;

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

      const boldKeywords = config.get<boolean>('boldKeywords', false);
      const italicComments = config.get<boolean>('italicComments', true);
      const useSemanticHighlighting = config.get<boolean>('useSemanticHighlighting', true);
      const debugMode = config.get<boolean>('debugMode', false);
      const overrides = config.get<Record<string, string>>('colorOverrides', {});

      const colorOverrides = new Map<string, string>();
      for (const [key, value] of Object.entries(overrides)) {
        colorOverrides.set(key, value);
      }

      return {
        boldKeywords,
        italicComments,
        colorOverrides,
        useSemanticHighlighting,
        debugMode
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

      // Extract direct color definitions (color-name "#RRGGBB")
      const colorRegex = /\(([a-zA-Z0-9-]+)\s+"(#[0-9a-fA-F]{6})"\)/g;
      let colorMatch: RegExpExecArray | null;

      while ((colorMatch = colorRegex.exec(content)) !== null) {
        const name = colorMatch[1];
        const value = colorMatch[2];

        try {
          Validator.notEmpty(name, 'Color name');
          Validator.hexColor(value, 'Color value');
          colors.set(name, value);
        } catch (error) {
          this.logger.warn(`Skipping invalid color: ${name}=${value}. ${error instanceof Error ? error.message : ''}`);
        }
      }

      // Extract semantic mappings (semantic-name color-name)
      const semanticRegex = /\(([a-zA-Z0-9-]+)\s+([a-zA-Z0-9-]+)\)/g;
      let semanticMatch: RegExpExecArray | null;

      while ((semanticMatch = semanticRegex.exec(content)) !== null) {
        const name = semanticMatch[1];
        const target = semanticMatch[2];

        if (!target.startsWith('#')) {
          semantics.set(name, target);
        }
      }

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
 * @const
 * @readonly
 */
const TEXTMATE_SCOPE_MAPPINGS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // Comments
  'comment': Object.freeze(['fg-dim']),
  'punctuation.definition.comment': Object.freeze(['fg-dim']),

  // Strings
  'string': Object.freeze(['blue-warmer']),
  'string.quoted': Object.freeze(['blue-warmer']),

  // Keywords and control flow
  'keyword': Object.freeze(['magenta-cooler']),
  'storage': Object.freeze(['magenta-warmer']),

  // Variables
  'variable': Object.freeze(['cyan']),
  'variable.other.constant': Object.freeze(['cyan-cooler']),
  'variable.language': Object.freeze(['cyan']),

  // Functions
  'entity.name.function': Object.freeze(['magenta']),
  'support.function': Object.freeze(['magenta']),

  // Types
  'entity.name.type': Object.freeze(['cyan-cooler']),
  'entity.other.inherited-class': Object.freeze(['cyan-cooler']),

  // Tags and markdown
  'entity.name.tag': Object.freeze(['green']),
  'markup.heading': Object.freeze(['green']),

  // Types and classes
  'support.type': Object.freeze(['cyan-cooler']),
  'support.class': Object.freeze(['cyan-cooler']),

  // Constants and numerics
  'constant.numeric': Object.freeze(['fg-main']),
  'constant.language': Object.freeze(['blue-cooler']),
  'support.constant': Object.freeze(['blue-cooler']),

  // Markup
  'markup.inline.raw': Object.freeze(['cyan']),
  'markup.fenced_code': Object.freeze(['cyan']),

  // Errors
  'invalid': Object.freeze(['red-warmer']),
  'message.error': Object.freeze(['red-warmer']),

  // Diffs and changes
  'markup.changed': Object.freeze(['yellow']),
  'meta.diff.header': Object.freeze(['yellow']),
  'markup.inserted': Object.freeze(['green-warmer']),
  'meta.diff.header.to-file': Object.freeze(['green-warmer']),
  'markup.deleted': Object.freeze(['red-cooler']),
  'meta.diff.header.from-file': Object.freeze(['red-cooler']),

  // Text styling
  'markup.italic': Object.freeze(['magenta-cooler']),
  'markup.bold': Object.freeze(['fg-main-intense']),
  'punctuation.definition.bold': Object.freeze(['fg-main-intense']),

  // Selectors
  'meta.selector': Object.freeze(['blue-intense']),
  'meta.object-literal.key': Object.freeze(['blue-intense']),

  // Properties and attributes
  'meta.property-name': Object.freeze(['fg-special-cold']),
  'entity.name.section': Object.freeze(['fg-special-cold']),
  'support.variable': Object.freeze(['fg-special-mild']),
  'variable.parameter': Object.freeze(['fg-special-mild']),
  'entity.other.attribute-name': Object.freeze(['fg-special-mild']),

  // Additional mappings
  'punctuation': Object.freeze(['fg-main']),
  'delimiter': Object.freeze(['fg-main']),
  'operator': Object.freeze(['fg-main']),
  'bracket': Object.freeze(['fg-main']),
  'builtin': Object.freeze(['magenta-warmer']),
  'docmarkup': Object.freeze(['magenta-faint']),
  'docstring': Object.freeze(['green-faint']),
  'preprocessor': Object.freeze(['red-cooler']),
  'rx-backslash': Object.freeze(['magenta']),
  'rx-construct': Object.freeze(['green-cooler'])
});

/**
 * VS Code UI color mappings
 *
 * Tokens auto-generated from https://code.visualstudio.com/api/references/theme-color
 *
 * @const
 * @readonly
 */
export const VS_CODE_UI_MAPPINGS: Record<string, string[]> = {
  // Contrast colors
  //
  // The contrast colors are typically only set for high contrast themes. If set, they add an additional border around items across the UI to increase the contrast.
  //
  // 'contrastActiveBorder': ['border-mode-line-active']                , // An extra border around active elements to separate them from others for greater contrast.
  // 'contrastBorder': ['border-region']                                , // An extra border around elements to separate them from others for greater contrast.

  // Base colors
  //
  'focusBorder': ['border-mode-line-active'],                             // Overall border color for focused elements. This color is only used if not overridden by a component.
  'foreground': ['fg-main'], // Overall foreground color. This color is only used if not overridden by a component.
  'disabledForeground': ['fg-dim'], // Overall foreground for disabled elements. This color is only used if not overridden by a component.
  'widget.border': ['bg-active'], // Border color of widgets such as Find/Replace inside the editor.
  'widget.shadow': ['bg-dim'], // Shadow color of widgets such as Find/Replace inside the editor.
  'selection.background': ['bg-region'], // Background color of text selections in the workbench (for input fields or text areas, does not apply to selections within the editor and the terminal).
  'descriptionForeground': ['fg-dim'], // Foreground color for description text providing additional information, for example for a label.
  'errorForeground': ['red'], // Overall foreground color for error messages (this color is only used if not overridden by a component).
  'icon.foreground': ['fg-main'], // The default color for icons in the workbench.
  'sash.hoverBorder': ['border-mode-line-active'], // The hover border color for draggable sashes.

  // Window border
  //
  // The theme colors for VS Code window border.
  'window.activeBorder': ['bg-mode-line-active'], // Border color for the active (focused) window.
  'window.inactiveBorder': ['bg-inactive'], // Border color for the inactive (unfocused) windows.

  // Text colors
  //
  // Colors inside a text document, such as the welcome page.
  'textBlockQuote.background': ['bg-dim'], // Background color for block quotes in text.
  'textBlockQuote.border': ['border-region'], // Border color for block quotes in text.
  'textCodeBlock.background': ['bg-dim'], // Background color for code blocks in text.
  'textLink.activeForeground': ['fg-link-visited'], // Foreground color for links in text when clicked on and on mouse hover.
  'textLink.foreground': ['fg-link'], // Foreground color for links in text.
  'textPreformat.foreground': ['fg-special-cold'], // Foreground color for preformatted text segments.
  'textPreformat.background': ['bg-dim'], // Background color for preformatted text segments.
  'textSeparator.foreground': ['fg-dim'], // Color for text separators.

  // Action colors
  //
  // A set of colors to control the interactions with actions across the workbench.
  'toolbar.hoverBackground': ['bg-hover'], // Toolbar background when hovering over actions using the mouse
  'toolbar.hoverOutline': ['border-mode-line-active'], // Toolbar outline when hovering over actions using the mouse
  'toolbar.activeBackground': ['bg-active'], // Toolbar background when holding the mouse over actions
  'editorActionList.background': ['bg-dim'], // Action List background color.
  'editorActionList.foreground': ['fg-main'], // Action List foreground color.
  'editorActionList.focusForeground': ['fg-active'], // Action List foreground color for the focused item.
  'editorActionList.focusBackground': ['bg-active-item'], // Action List background color for the focused item.

  // Button control
  //
  // A set of colors for button widgets such as Open Folder button in the Explorer of a new window.
  'button.background': ['bg-active'], // Button background color.
  'button.foreground': ['fg-active'], // Button foreground color.
  'button.border': ['border-region'], // Button border color.
  'button.separator': ['fg-dim'], // Button separator color.
  'button.hoverBackground': ['bg-active-item'], // Button background color when hovering.
  'button.secondaryForeground': ['fg-main'], // Secondary button foreground color.
  'button.secondaryBackground': ['bg-dim'], // Secondary button background color.
  'button.secondaryHoverBackground': ['bg-hover'], // Secondary button background color when hovering.
  'checkbox.background': ['bg-inactive'], // Background color of checkbox widget.
  'checkbox.foreground': ['fg-main'], // Foreground color of checkbox widget.
  'checkbox.border': ['border-region'], // Border color of checkbox widget.
  'checkbox.selectBackground': ['bg-active'], // Background color of checkbox widget when the element it's in is selected.
  'checkbox.selectBorder': ['border-mode-line-active'], // Border color of checkbox widget when the element it's in is selected.
  'radio.activeForeground': ['fg-active'], // Foreground color of active radio option.
  'radio.activeBackground': ['bg-active'], // Background color of active radio option.
  'radio.activeBorder': ['border-mode-line-active'], // Border color of the active radio option.
  'radio.inactiveForeground': ['fg-main'], // Foreground color of inactive radio option.
  'radio.inactiveBackground': ['bg-inactive'], // Background color of inactive radio option.
  'radio.inactiveBorder': ['border-region'], // Border color of the inactive radio option.
  'radio.inactiveHoverBackground': ['bg-hover'], // Background color of inactive active radio option when hovering.

  // Dropdown control
  //
  // A set of colors for all Dropdown widgets such as in the Integrated Terminal or the Output panel. Note that the Dropdown control is not used on macOS currently.
  'dropdown.background': ['bg-dim'], // Dropdown background.
  'dropdown.listBackground': ['bg-alt'], // Dropdown list background.
  'dropdown.border': ['border-region'], // Dropdown border.
  'dropdown.foreground': ['fg-main'], // Dropdown foreground.

  // Input control
  //
  // Colors for input controls such as in the Search view or the Find/Replace dialog.
  'input.background': ['bg-dim'], // Input box background.
  'input.foreground': ['fg-main'], // Input box foreground.
  'input.border': ['border-region'], // Input box border.
  'input.placeholderForeground': ['fg-dim'], // Input box foreground color for placeholder text.
  'inputOption.activeBackground': ['bg-active'], // Background color of activated options in input fields.
  'inputOption.activeBorder': ['border-mode-line-active'], // Border color of activated options in input fields.
  'inputOption.activeForeground': ['fg-active'], // Foreground color of activated options in input fields.
  'inputOption.hoverBackground': ['bg-hover'], // Background color of activated options in input fields when hovered.
  'inputValidation.errorBackground': ['bg-red-subtle'], // Input validation background color for error severity.
  'inputValidation.errorForeground': ['red'], // Input validation foreground color for error severity.
  'inputValidation.errorBorder': ['red-warmer'], // Input validation border color for error severity.
  'inputValidation.infoBackground': ['bg-blue-subtle'], // Input validation background color for information severity.
  'inputValidation.infoForeground': ['blue'], // Input validation foreground color for information severity.
  'inputValidation.infoBorder': ['blue-warmer'], // Input validation border color for information severity.
  'inputValidation.warningBackground': ['bg-yellow-subtle'], // Input validation background color for information warning.
  'inputValidation.warningForeground': ['yellow'], // Input validation foreground color for warning severity.
  'inputValidation.warningBorder': ['yellow-warmer'], // Input validation border color for warning severity.

  // Scrollbar control
  //
  // Colors for scrollbars.
  'scrollbar.shadow': ['bg-dim'], // Scrollbar slider shadow to indicate that the view is scrolled.
  'scrollbarSlider.activeBackground': ['bg-scroll-active'], // Scrollbar slider background color when clicked on.
  'scrollbarSlider.background': ['bg-scroll'], // Scrollbar slider background color.
  'scrollbarSlider.hoverBackground': ['bg-scroll-hover'], // Scrollbar slider background color when hovering.

  // Badge
  //
  // Badges are small information labels, for example, search results count.
  'badge.foreground': ['fg-active'], // Badge foreground color.
  'badge.background': ['bg-active'], // Badge background color.

  // Progress bar
  //
  // Colors for progress bars.
  'progressBar.background': ['bg-active'], // Background color of the progress bar shown for long running operations.

  // Lists and trees
  //
  // Colors for list and trees like the File Explorer. An active list/tree has keyboard focus, an inactive does not.
  'list.activeSelectionBackground': ['bg-active-item'], // List/Tree background color for the selected item when the list/tree is active.
  'list.activeSelectionForeground': ['fg-active'], // List/Tree foreground color for the selected item when the list/tree is active.
  'list.activeSelectionIconForeground': ['fg-active'], // List/Tree icon foreground color for the selected item when the list/tree is active. An active list/tree has keyboard focus, an inactive does not.
  'list.dropBackground': ['bg-dim'], // List/Tree drag and drop background when moving items around using the mouse.
  'list.focusBackground': ['bg-active-item'], // List/Tree background color for the focused item when the list/tree is active.
  'list.focusForeground': ['fg-active'], // List/Tree foreground color for the focused item when the list/tree is active. An active list/tree has keyboard focus, an inactive does not.
  'list.focusHighlightForeground': ['fg-active'], // List/Tree foreground color of the match highlights on actively focused items when searching inside the list/tree.
  'list.focusOutline': ['border-mode-line-active'], // List/Tree outline color for the focused item when the list/tree is active. An active list/tree has keyboard focus, an inactive does not.
  'list.focusAndSelectionOutline': ['border-mode-line-active'], // List/Tree outline color for the focused item when the list/tree is active and selected. An active list/tree has keyboard focus, an inactive does not.
  'list.highlightForeground': ['fg-active'], // List/Tree foreground color of the match highlights when searching inside the list/tree.
  'list.hoverBackground': ['bg-hover'], // List/Tree background when hovering over items using the mouse.
  'list.hoverForeground': ['fg-main'], // List/Tree foreground when hovering over items using the mouse.
  'list.inactiveSelectionBackground': ['bg-inactive'], // List/Tree background color for the selected item when the list/tree is inactive.
  'list.inactiveSelectionForeground': ['fg-inactive'], // List/Tree foreground color for the selected item when the list/tree is inactive. An active list/tree has keyboard focus, an inactive does not.
  'list.inactiveSelectionIconForeground': ['fg-inactive'], // List/Tree icon foreground color for the selected item when the list/tree is inactive. An active list/tree has keyboard focus, an inactive does not.
  'list.inactiveFocusBackground': ['bg-inactive'], // List background color for the focused item when the list is inactive. An active list has keyboard focus, an inactive does not. Currently only supported in lists.
  'list.inactiveFocusOutline': ['border-mode-line-inactive'], // List/Tree outline color for the focused item when the list/tree is inactive. An active list/tree has keyboard focus, an inactive does not.
  'list.invalidItemForeground': ['red-warmer'], // List/Tree foreground color for invalid items, for example an unresolved root in explorer.
  'list.errorForeground': ['red'], // Foreground color of list items containing errors.
  'list.warningForeground': ['yellow-warmer'], // Foreground color of list items containing warnings.
  'listFilterWidget.background': ['bg-dim'], // List/Tree Filter background color of typed text when searching inside the list/tree.
  'listFilterWidget.outline': ['border-region'], // List/Tree Filter Widget's outline color of typed text when searching inside the list/tree.
  'listFilterWidget.noMatchesOutline': ['red-warmer'], // List/Tree Filter Widget's outline color when no match is found of typed text when searching inside the list/tree.
  'listFilterWidget.shadow': ['bg-dim'], // Shadow color of the type filter widget in lists and tree.
  'list.filterMatchBackground': ['bg-search-lazy'], // Background color of the filtered matches in lists and trees.
  'list.filterMatchBorder': ['border-search-lazy'], // Border color of the filtered matches in lists and trees.
  'list.deemphasizedForeground': ['fg-dim'], // List/Tree foreground color for items that are deemphasized.
  'list.dropBetweenBackground': [''], // List/Tree drag and drop border color when moving items between items when using the mouse.
  'tree.indentGuidesStroke': [''], // Tree Widget's stroke color for indent guides.
  'tree.inactiveIndentGuidesStroke': [''], // Tree stroke color for the indentation guides that are not active.
  'tree.tableColumnsBorder': [''], // Tree stroke color for the indentation guides.
  'tree.tableOddRowsBackground': [''], // Background color for odd table rows.

  // Activity Bar
  //
  // The Activity Bar is usually displayed either on the far left or right of the workbench and allows fast switching between views of the Side Bar.
  'activityBar.background': ['bg-mode-line-inactive'], // Activity Bar background color.
  'activityBar.dropBorder': ['border-mode-line-active'], // Drag and drop feedback color for the activity bar items. The activity bar is showing on the far left or right and allows to switch between views of the side bar.
  'activityBar.foreground': ['fg-main'], // Activity Bar foreground color (for example used for the icons).
  'activityBar.inactiveForeground': ['fg-dim'], // Activity Bar item foreground color when it is inactive.
  'activityBar.border': ['border-mode-line-inactive'], // Activity Bar border color with the Side Bar.
  'activityBarBadge.background': ['bg-active'], // Activity notification badge background color.
  'activityBarBadge.foreground': ['fg-main'], // Activity notification badge foreground color.
  'activityBar.activeBorder': ['border-mode-line-active'], // Activity Bar active indicator border color.
  'activityBar.activeBackground': ['bg-active'], // Activity Bar optional background color for the active element.
  'activityBar.activeFocusBorder': ['border-mode-line-active'], // Activity bar focus border color for the active item.
  'activityBarTop.foreground': ['fg-main'], // Active foreground color of the item in the Activity bar when it is on top. The activity allows to switch between views of the side bar.
  'activityBarTop.activeBorder': ['border-mode-line-active'], // Focus border color for the active item in the Activity bar when it is on top. The activity allows to switch between views of the side bar.
  'activityBarTop.inactiveForeground': ['fg-dim'], // Inactive foreground color of the item in the Activity bar when it is on top. The activity allows to switch between views of the side bar.
  'activityBarTop.dropBorder': ['border-mode-line-active'], // Drag and drop feedback color for the items in the Activity bar when it is on top. The activity allows to switch between views of the side bar.
  'activityBarTop.background': ['bg-alt'], // Background color of the activity bar when set to top / bottom.
  'activityBarTop.activeBackground': ['bg-active'], // Background color for the active item in the Activity bar when it is on top / bottom. The activity allows to switch between views of the side bar.
  'activityWarningBadge.foreground': ['fg-active'], // Foreground color of the warning activity badge
  'activityWarningBadge.background': ['yellow-warmer'], // Background color of the warning activity badge
  'activityErrorBadge.foreground': ['fg-active'], // Foreground color of the error activity badge
  'activityErrorBadge.background': ['red-warmer'], // Background color of the error activity badge

  // Profiles

  'profileBadge.background': ['bg-active'], // Profile badge background color. The profile badge shows on top of the settings gear icon in the activity bar.
  'profileBadge.foreground': ['fg-active'], // Profile badge foreground color. The profile badge shows on top of the settings gear icon in the activity bar.
  'profiles.sashBorder': ['border-region'], // The color of the Profiles editor splitview sash border.

  // Side Bar
  //
  // The Side Bar contains views like the Explorer and Search.
  'sideBar.background': ['bg-dim'], // Side Bar background color.
  'sideBar.foreground': ['fg-main'], // Side Bar foreground color. The Side Bar is the container for views like Explorer and Search.
  'sideBar.border': ['border-region'], // Side Bar border color on the side separating the editor.
  'sideBar.dropBackground': ['bg-dim'], // Drag and drop feedback color for the side bar sections. The color should have transparency so that the side bar sections can still shine through.
  'sideBarTitle.foreground': ['fg-special-cold'], // Side Bar title foreground color.
  'sideBarSectionHeader.background': ['bg-alt'], // Side Bar section header background color.
  'sideBarSectionHeader.foreground': ['fg-special-cold'], // Side Bar section header foreground color.
  'sideBarSectionHeader.border': ['border-region'], // Side bar section header border color.
  'sideBarActivityBarTop.border': ['border-region'], // Border color between the activity bar at the top/bottom and the views.
  'sideBarTitle.background': ['bg-alt'], // Side bar title background color. The side bar is the container for views like explorer and search.
  'sideBarTitle.border': ['border-region'], // Side bar title border color on the bottom, separating the title from the views. The side bar is the container for views like explorer and search.
  'sideBarStickyScroll.background': ['bg-dim'], // Background color of sticky scroll in the side bar.
  'sideBarStickyScroll.border': ['border-region'], // Border color of sticky scroll in the side bar.
  'sideBarStickyScroll.shadow': ['bg-dim'], // Shadow color of sticky scroll in the side bar.

  // Minimap
  //
  // The Minimap shows a minified version of the current file.
  'minimap.findMatchHighlight': ['bg-search-lazy'], // Highlight color for matches from search within files.
  'minimap.selectionHighlight': ['bg-region'], // Highlight color for the editor selection.
  'minimap.errorHighlight': ['red-warmer'], // Highlight color for errors within the editor.
  'minimap.warningHighlight': ['yellow-warmer'], // Highlight color for warnings within the editor.
  'minimap.background': ['bg-dim'], // Minimap background color.
  'minimap.selectionOccurrenceHighlight': ['bg-active-item'], // Minimap marker color for repeating editor selections.
  'minimap.foregroundOpacity': ['#00000080'], // Opacity of foreground elements rendered in the minimap. For example, "#000000c0" will render the elements with 75% opacity.
  'minimap.infoHighlight': ['blue-warmer'], // Minimap marker color for infos.
  'minimap.chatEditHighlight': ['magenta-warmer'], // Color of pending edit regions in the minimap.
  'minimapSlider.background': ['bg-scroll'], // Minimap slider background color.
  'minimapSlider.hoverBackground': ['bg-scroll-hover'], // Minimap slider background color when hovering.
  'minimapSlider.activeBackground': ['bg-scroll-active'], // Minimap slider background color when clicked on.
  'minimapGutter.addedBackground': ['green-warmer'], // Minimap gutter color for added content.
  'minimapGutter.modifiedBackground': ['yellow-warmer'], // Minimap gutter color for modified content.
  'minimapGutter.deletedBackground': ['red-warmer'], // Minimap gutter color for deleted content.
  'editorMinimap.inlineChatInserted': ['green-warmer'], // Minimap marker color for inline chat inserted content.

  // Editor Groups & Tabs
  //
  // Editor Groups are the containers of editors. There can be many editor groups. A Tab is the container of an editor. Multiple Tabs can be opened in one editor group.

  'editorGroup.border': ['border-region'], // Color to separate multiple editor groups from each other.
  'editorGroup.dropBackground': ['bg-dim'], // Background color when dragging editors around.
  'editorGroupHeader.noTabsBackground': ['bg-alt'], // Background color of the editor group title header when using single Tab (set "workbench.editor.showTabs": "single").
  'editorGroupHeader.tabsBackground': ['bg-alt'], // Background color of the Tabs container.
  'editorGroupHeader.tabsBorder': ['border-region'], // Border color below the editor tabs control when tabs are enabled.
  'editorGroupHeader.border': ['border-region'], // Border color between editor group header and editor (below breadcrumbs if enabled).
  'editorGroup.emptyBackground': ['bg-dim'], // Background color of an empty editor group.
  'editorGroup.focusedEmptyBorder': ['border-mode-line-active'], // Border color of an empty editor group that is focused.
  'editorGroup.dropIntoPromptForeground': ['fg-main'], // Foreground color of text shown over editors when dragging files. This text informs the user that they can hold shift to drop into the editor.
  'editorGroup.dropIntoPromptBackground': ['bg-dim'], // Background color of text shown over editors when dragging files. This text informs the user that they can hold shift to drop into the editor.
  'editorGroup.dropIntoPromptBorder': ['border-region'], // Border color of text shown over editors when dragging files. This text informs the user that they can hold shift to drop into the editor.
  'tab.activeBackground': ['bg-main'], // Active Tab background color in an active group.
  'tab.unfocusedActiveBackground': ['bg-inactive'], // Active Tab background color in an inactive editor group.
  'tab.activeForeground': ['fg-main'], // Active Tab foreground color in an active group.
  'tab.border': ['border-region'], // Border to separate Tabs from each other.
  'tab.activeBorder': ['border-mode-line-active'], // Bottom border for the active tab.
  'tab.selectedBorderTop': ['border-mode-line-active'], // Border to the top of a selected tab. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups.
  'tab.selectedBackground': ['bg-active'], // Background of a selected tab. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups.
  'tab.selectedForeground': ['fg-active'], // Foreground of a selected tab. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups.
  'tab.dragAndDropBorder': ['border-mode-line-active'], // Border between tabs to indicate that a tab can be inserted between two tabs. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups.
  'tab.unfocusedActiveBorder': ['border-mode-line-inactive'], // Bottom border for the active tab in an inactive editor group.
  'tab.activeBorderTop': ['border-mode-line-active'], // Top border for the active tab.
  'tab.unfocusedActiveBorderTop': ['border-mode-line-inactive'], // Top border for the active tab in an inactive editor group
  'tab.lastPinnedBorder': ['border-region'], // Border on the right of the last pinned editor to separate from unpinned editors.
  'tab.inactiveBackground': ['bg-dim'], // Inactive Tab background color.
  'tab.unfocusedInactiveBackground': ['bg-inactive'], // Inactive Tab background color in an unfocused group
  'tab.inactiveForeground': ['fg-dim'], // Inactive Tab foreground color in an active group.
  'tab.unfocusedActiveForeground': ['fg-dim'], // Active tab foreground color in an inactive editor group.
  'tab.unfocusedInactiveForeground': ['fg-dim'], // Inactive tab foreground color in an inactive editor group.
  'tab.hoverBackground': ['bg-hover'], // Tab background color when hovering
  'tab.unfocusedHoverBackground': ['bg-hover'], // Tab background color in an unfocused group when hovering
  'tab.hoverForeground': ['fg-main'], // Tab foreground color when hovering
  'tab.unfocusedHoverForeground': ['fg-dim'], // Tab foreground color in an unfocused group when hovering
  'tab.hoverBorder': ['border-mode-line-active'], // Border to highlight tabs when hovering
  'tab.unfocusedHoverBorder': ['border-mode-line-inactive'], // Border to highlight tabs in an unfocused group when hovering
  'tab.activeModifiedBorder': ['yellow-warmer'], // Border on the top of modified (dirty) active tabs in an active group.
  'tab.inactiveModifiedBorder': ['yellow'], // Border on the top of modified (dirty) inactive tabs in an active group.
  'tab.unfocusedActiveModifiedBorder': ['yellow'], // Border on the top of modified (dirty) active tabs in an unfocused group.
  'tab.unfocusedInactiveModifiedBorder': ['yellow'], // Border on the top of modified (dirty) inactive tabs in an unfocused group.
  'editorPane.background': ['bg-dim'], // Background color of the editor pane visible on the left and right side of the centered editor layout.
  'sideBySideEditor.horizontalBorder': ['border-region'], // Color to separate two editors from each other when shown side by side in an editor group from top to bottom.
  'sideBySideEditor.verticalBorder': ['border-region'], // Color to separate two editors from each other when shown side by side in an editor group from left to right.

  // Editor colors
  //
  // The most prominent editor colors are the token colors used for syntax highlighting and are based on the language grammar installed. These colors are defined by the Color Theme but can also be customized with the editor.tokenColorCustomizations setting. See Customizing a Color Theme for details on updating a Color Theme and the available token types.
  //
  // All other editor colors are listed here:

  'editor.background': ['bg-main'], // Editor background color.
  'editor.foreground': ['fg-main'], // Editor default foreground color.
  'editorLineNumber.foreground': ['fg-dim'], // Color of editor line numbers.
  'editorLineNumber.activeForeground': ['fg-main'], // Color of the active editor line number.
  'editorLineNumber.dimmedForeground': ['fg-dim'], // Color of the final editor line when editor.renderFinalNewline is set to dimmed.
  'editorCursor.background': ['bg-main'], // The background color of the editor cursor. Allows customizing the color of a character overlapped by a block cursor.
  'editorCursor.foreground': ['fg-main'], // Color of the editor cursor.
  'editorMultiCursor.primary.foreground': ['fg-main'], // Color of the primary editor cursor when multiple cursors are present.
  'editorMultiCursor.primary.background': ['bg-main'], // The background color of the primary editor cursor when multiple cursors are present. Allows customizing the color of a character overlapped by a block cursor.
  'editorMultiCursor.secondary.foreground': ['fg-dim'], // Color of secondary editor cursors when multiple cursors are present.
  'editorMultiCursor.secondary.background': ['bg-dim'], // The background color of secondary editor cursors when multiple cursors are present. Allows customizing the color of a character overlapped by a block cursor.
  'editor.placeholder.foreground': ['fg-dim'], // Foreground color of the placeholder text in the editor.
  'editor.compositionBorder': ['border-mode-line-active'], // The border color for an IME composition.

  // Selection colors are visible when selecting one or more characters. In addition to the selection also all regions with the same content are highlighted.

  // selection highlight

  'editor.selectionBackground': ['bg-region'], // Color of the editor selection.
  'editor.selectionForeground': ['fg-main'], // Color of the selected text for high contrast.
  'editor.inactiveSelectionBackground': ['bg-inactive'], // Color of the selection in an inactive editor. The color must not be opaque so as not to hide underlying decorations.
  'editor.selectionHighlightBackground': ['bg-region'], // Color for regions with the same content as the selection. The color must not be opaque so as not to hide underlying decorations.
  'editor.selectionHighlightBorder': ['border-region'], // Border color for regions with the same content as the selection.

  // Word highlight colors are visible when the cursor is inside a symbol or a word. Depending on the language support available for the file type, all matching references and declarations are highlighted and read and write accesses get different colors. If document symbol language support is not available, this falls back to word highlighting.

  // occurrences

  'editor.wordHighlightBackground': ['bg-region'], // Background color of a symbol during read-access, for example when reading a variable. The color must not be opaque so as not to hide underlying decorations.
  'editor.wordHighlightBorder': ['border-region'], // Border color of a symbol during read-access, for example when reading a variable.
  'editor.wordHighlightStrongBackground': ['bg-active-item'], // Background color of a symbol during write-access, for example when writing to a variable. The color must not be opaque so as not to hide underlying decorations.
  'editor.wordHighlightStrongBorder': ['border-mode-line-active'], // Border color of a symbol during write-access, for example when writing to a variable.
  'editor.wordHighlightTextBackground': ['bg-region'], // Background color of a textual occurrence for a symbol. The color must not be opaque so as not to hide underlying decorations.
  'editor.wordHighlightTextBorder': ['border-region'], // Border color of a textual occurrence for a symbol.

  // Find colors depend on the current find string in the Find/Replace dialog.

  'findMatchBackground': ['bg-search-lazy'], // Color of the current search match.
  'findMatchForeground': ['fg-main'], // Text color of the current search match.
  'findMatchHighlightForeground': ['fg-main'], // Foreground color of the other search matches.
  'findMatchHighlightBackground': ['bg-search-lazy'], // Color of the other search matches. The color must not be opaque so as not to hide underlying decorations.
  'findRangeHighlightBackground': ['bg-dim'], // Color the range limiting the search (Enable 'Find in Selection' in the find widget). The color must not be opaque so as not to hide underlying decorations.
  'findMatchBorder': ['border-search-lazy'], // Border color of the current search match.
  'findMatchHighlightBorder': ['border-search-lazy'], // Border color of the other search matches.
  'findRangeHighlightBorder': ['border-region'], // Border color the range limiting the search (Enable 'Find in Selection' in the find widget).

  // Search colors are used in the search viewlet's global search results.

  'search.resultsInfoForeground': ['fg-dim'], // Color of the text in the search viewlet's completion message. For example, this color is used in the text that says "{x} results in {y} files".

  // Search Editor colors highlight results in a Search Editor. This can be configured separately from other find matches in order to better differentiate between different classes of match in the same editor.

  'searchEditor.findMatchBackground': ['bg-search-lazy'], // Color of the editor's results.
  'searchEditor.findMatchBorder': ['border-search-lazy'], // Border color of the editor's results.
  'searchEditor.textInputBorder': ['border-region'], // Search editor text input box border.

  // The hover highlight is shown behind the symbol for which a hover is shown.

  'hoverHighlightBackground': ['bg-hover'], // Highlight below the word for which a hover is shown. The color must not be opaque so as not to hide underlying decorations.

  // The current line is typically shown as either background highlight or a border (not both).

  'lineHighlightBackground': ['bg-hl-line'], // Background color for the highlight of line at the cursor position.
  'lineHighlightBorder': ['bg-hl-line-intense'], // Background color for the border around the line at the cursor position.

  // The color for the editor watermark

  'editorWatermark.foreground': ['fg-dim'], // Foreground color for the labels in the editor watermark.

  // The color for unicode highlights

  'editorUnicodeHighlight.border': ['yellow-warmer'], // Border color used to highlight unicode characters.
  'editorUnicodeHighlight.background': ['bg-yellow-subtle'], // Background color used to highlight unicode characters.

  // The link color is visible when clicking on a link.

  'editorLink.activeForeground': ['fg-link'], // Color of active links.

  // The range highlight is visible when selecting a search result.

  'rangeHighlightBackground': ['bg-dim'], // Background color of highlighted ranges, used by Quick Open, Symbol in File and Find features. The color must not be opaque so as not to hide underlying decorations.
  'rangeHighlightBorder': ['border-region'], // Background color of the border around highlighted ranges.

  // The symbol highlight is visible when navigating to a symbol via a command such as Go to Definition.

  'symbolHighlightBackground': ['bg-region'], // Background color of highlighted symbol. The color must not be opaque so as not to hide underlying decorations.
  'symbolHighlightBorder': ['border-region'], // Background color of the border around highlighted symbols.

  // To see the editor white spaces, enable Toggle Render Whitespace.

  'editorWhitespace.foreground': ['fg-whitespace'], // Color of whitespace characters in the editor.

  // To see the editor indent guides, set "editor.guides.indentation": true and "editor.guides.highlightActiveIndentation": true.

  'editorIndentGuide.background': ['bg-inactive'], // Color of the editor indentation guides.
  'editorIndentGuide.background1': ['bg-inactive'], // Color of the editor indentation guides (1).
  'editorIndentGuide.background2': ['bg-inactive'], // Color of the editor indentation guides (2).
  'editorIndentGuide.background3': ['bg-inactive'], // Color of the editor indentation guides (3).
  'editorIndentGuide.background4': ['bg-inactive'], // Color of the editor indentation guides (4).
  'editorIndentGuide.background5': ['bg-inactive'], // Color of the editor indentation guides (5).
  'editorIndentGuide.background6': ['bg-inactive'], // Color of the editor indentation guides (6).
  'editorIndentGuide.activeBackground': ['fg-dim'], // Color of the active editor indentation guide.
  'editorIndentGuide.activeBackground1': ['fg-dim'], // Color of the active editor indentation guides (1).
  'editorIndentGuide.activeBackground2': ['fg-dim'], // Color of the active editor indentation guides (2).
  'editorIndentGuide.activeBackground3': ['fg-dim'], // Color of the active editor indentation guides (3).
  'editorIndentGuide.activeBackground4': ['fg-dim'], // Color of the active editor indentation guides (4).
  'editorIndentGuide.activeBackground5': ['fg-dim'], // Color of the active editor indentation guides (5).
  'editorIndentGuide.activeBackground6': ['fg-dim'], // Color of the active editor indentation guides (6).

  // To see the editor inline hints, set "editor.inlineSuggest.enabled": true.

  'editorInlayHint.background': ['bg-dim'], // Background color of inline hints.
  'editorInlayHint.foreground': ['fg-dim'], // Foreground color of inline hints.
  'editorInlayHint.typeForeground': ['fg-special-cold'], // Foreground color of inline hints for types
  'editorInlayHint.typeBackground': ['bg-dim'], // Background color of inline hints for types
  'editorInlayHint.parameterForeground': ['fg-special-warm'], // Foreground color of inline hints for parameters
  'editorInlayHint.parameterBackground': ['bg-dim'], // Background color of inline hints for parameters

  // To see editor rulers, define their location with "editor.rulers"

  'editorRuler.foreground': ['fg-dim'], // Color of the editor rulers.

  'editor.linkedEditingBackground': ['bg-region'], // Background color when the editor is in linked editing mode.

  // CodeLens:

  'editorCodeLens.foreground': ['fg-dim'], // Foreground color of an editor CodeLens.

  // Lightbulb:

  'editorLightBulb.foreground': ['yellow'], // The color used for the lightbulb actions icon.
  'editorLightBulbAutoFix.foreground': ['blue'], // The color used for the lightbulb auto fix actions icon.
  'editorLightBulbAi.foreground': ['magenta'], // The color used for the lightbulb AI icon.

  // Bracket matches:

  'editorBracketMatch.background': ['bg-paren-match'], // Background color behind matching brackets.
  'editorBracketMatch.border': ['border-mode-line-active'], // Color for matching brackets boxes.

  // Bracket pair colorization:

  'editorBracketHighlight.foreground1': ['red'], // Foreground color of brackets (1). Requires enabling bracket pair colorization.
  'editorBracketHighlight.foreground2': ['green'], // Foreground color of brackets (2). Requires enabling bracket pair colorization.
  'editorBracketHighlight.foreground3': ['yellow'], // Foreground color of brackets (3). Requires enabling bracket pair colorization.
  'editorBracketHighlight.foreground4': ['blue'], // Foreground color of brackets (4). Requires enabling bracket pair colorization.
  'editorBracketHighlight.foreground5': ['magenta'], // Foreground color of brackets (5). Requires enabling bracket pair colorization.
  'editorBracketHighlight.foreground6': ['cyan'], // Foreground color of brackets (6). Requires enabling bracket pair colorization.
  'editorBracketHighlight.unexpectedBracket.foreground': ['red-warmer'], // Foreground color of unexpected brackets.

  // Bracket pair guides:

  'editorBracketPairGuide.activeBackground1': ['red'], // Background color of active bracket pair guides (1). Requires enabling bracket pair guides.
  'editorBracketPairGuide.activeBackground2': ['green'], // Background color of active bracket pair guides (2). Requires enabling bracket pair guides.
  'editorBracketPairGuide.activeBackground3': ['yellow'], // Background color of active bracket pair guides (3). Requires enabling bracket pair guides.
  'editorBracketPairGuide.activeBackground4': ['blue'], // Background color of active bracket pair guides (4). Requires enabling bracket pair guides.
  'editorBracketPairGuide.activeBackground5': ['magenta'], // Background color of active bracket pair guides (5). Requires enabling bracket pair guides.
  'editorBracketPairGuide.activeBackground6': ['cyan'], // Background color of active bracket pair guides (6). Requires enabling bracket pair guides.
  'editorBracketPairGuide.background1': ['bg-red-subtle'], // Background color of inactive bracket pair guides (1). Requires enabling bracket pair guides.
  'editorBracketPairGuide.background2': ['bg-green-subtle'], // Background color of inactive bracket pair guides (2). Requires enabling bracket pair guides.
  'editorBracketPairGuide.background3': ['bg-yellow-subtle'], // Background color of inactive bracket pair guides (3). Requires enabling bracket pair guides.
  'editorBracketPairGuide.background4': ['bg-blue-subtle'], // Background color of inactive bracket pair guides (4). Requires enabling bracket pair guides.
  'editorBracketPairGuide.background5': ['bg-magenta-subtle'], // Background color of inactive bracket pair guides (5). Requires enabling bracket pair guides.
  'editorBracketPairGuide.background6': ['bg-cyan-subtle'], // Background color of inactive bracket pair guides (6). Requires enabling bracket pair guides.

  // Folding:

  'editor.foldBackground': ['bg-inactive'], // Background color for folded ranges. The color must not be opaque so as not to hide underlying decorations.
  'editor.foldPlaceholderForeground': ['fg-dim'], // Color of the collapsed text after the first line of a folded range.

  // Overview ruler:

  'editorOverviewRuler.background': ['bg-dim'], // Background color of the editor overview ruler. Only used when the minimap is enabled and placed on the right side of the editor.
  'editorOverviewRuler.border': ['border-region'], // Color of the overview ruler border.
  'editorOverviewRuler.findMatchForeground': ['fg-search-lazy'], // Overview ruler marker color for find matches. The color must not be opaque so as not to hide underlying decorations.
  'editorOverviewRuler.rangeHighlightForeground': ['fg-dim'], // Overview ruler marker color for highlighted ranges, like by the Quick Open, Symbol in File and Find features. The color must not be opaque so as not to hide underlying decorations.
  'editorOverviewRuler.selectionHighlightForeground': ['fg-dim'], // Overview ruler marker color for selection highlights. The color must not be opaque so as not to hide underlying decorations.
  'editorOverviewRuler.wordHighlightForeground': ['fg-dim'], // Overview ruler marker color for symbol highlights. The color must not be opaque so as not to hide underlying decorations.
  'editorOverviewRuler.wordHighlightStrongForeground': ['fg-main'], // Overview ruler marker color for write-access symbol highlights. The color must not be opaque so as not to hide underlying decorations.
  'editorOverviewRuler.wordHighlightTextForeground': ['fg-dim'], // Overview ruler marker color of a textual occurrence for a symbol. The color must not be opaque so as not to hide underlying decorations.
  'editorOverviewRuler.modifiedForeground': ['yellow-warmer'], // Overview ruler marker color for modified content.
  'editorOverviewRuler.addedForeground': ['green-warmer'], // Overview ruler marker color for added content.
  'editorOverviewRuler.deletedForeground': ['red-warmer'], // Overview ruler marker color for deleted content.
  'editorOverviewRuler.errorForeground': ['red'], // Overview ruler marker color for errors.
  'editorOverviewRuler.warningForeground': ['yellow'], // Overview ruler marker color for warnings.
  'editorOverviewRuler.infoForeground': ['blue'], // Overview ruler marker color for infos.
  'editorOverviewRuler.bracketMatchForeground': ['fg-main'], // Overview ruler marker color for matching brackets.
  'editorOverviewRuler.inlineChatInserted': ['green-warmer'], // Overview ruler marker color for inline chat inserted content.
  'editorOverviewRuler.inlineChatRemoved': ['red-warmer'], // Overview ruler marker color for inline chat removed content.

  // Errors and warnings:

  'editorError.foreground': ['red'], // Foreground color of error squiggles in the editor.
  'editorError.border': ['red-warmer'], // Border color of error boxes in the editor.
  'editorError.background': ['bg-red-subtle'], // Background color of error text in the editor. The color must not be opaque so as not to hide underlying decorations.
  'editorWarning.foreground': ['yellow'], // Foreground color of warning squiggles in the editor.
  'editorWarning.border': ['yellow-warmer'], // Border color of warning boxes in the editor.
  'editorWarning.background': ['bg-yellow-subtle'], // Background color of warning text in the editor. The color must not be opaque so as not to hide underlying decorations.
  'editorInfo.foreground': ['blue'], // Foreground color of info squiggles in the editor.
  'editorInfo.border': ['blue-warmer'], // Border color of info boxes in the editor.
  'editorInfo.background': ['bg-blue-subtle'], // Background color of info text in the editor. The color must not be opaque so as not to hide underlying decorations.
  'editorHint.foreground': ['cyan'], // Foreground color of hints in the editor.
  'editorHint.border': ['cyan-warmer'], // Border color of hint boxes in the editor.
  'problemsErrorIcon.foreground': ['red'], // The color used for the problems error icon.
  'problemsWarningIcon.foreground': ['yellow'], // The color used for the problems warning icon.
  'problemsInfoIcon.foreground': ['blue'], // The color used for the problems info icon.

  // Unused source code:

  'editorUnnecessaryCode.border': ['border-region'], // Border color of unnecessary (unused) source code in the editor.
  'editorUnnecessaryCode.opacity': ['#00000080'], // Opacity of unnecessary (unused) source code in the editor. For example, "#000000c0" will render the code with 75% opacity. For high contrast themes, use the "editorUnnecessaryCode.border" theme color to underline unnecessary code instead of fading it out.

  // The gutter contains the glyph margins and the line numbers:

  'editorGutter.background': ['bg-main'], // Background color of the editor gutter. The gutter contains the glyph margins and the line numbers.
  'editorGutter.modifiedBackground': ['yellow-warmer'], // Editor gutter background color for lines that are modified.
  'editorGutter.addedBackground': ['green-warmer'], // Editor gutter background color for lines that are added.
  'editorGutter.deletedBackground': ['red-warmer'], // Editor gutter background color for lines that are deleted.
  'editorGutter.commentRangeForeground': ['fg-comment'], // Editor gutter decoration color for commenting ranges.
  'editorGutter.commentGlyphForeground': ['fg-comment'], // Editor gutter decoration color for commenting glyphs.
  'editorGutter.commentUnresolvedGlyphForeground': ['yellow-warmer'], // Editor gutter decoration color for commenting glyphs for unresolved comment threads.
  'editorGutter.foldingControlForeground': ['fg-dim'], // Color of the folding control in the editor gutter.

  // The editor comments widget can be seen when reviewing pull requests:

  'editorCommentsWidget.resolvedBorder': ['green-warmer'], // Color of borders and arrow for resolved comments.
  'editorCommentsWidget.unresolvedBorder': ['yellow-warmer'], // Color of borders and arrow for unresolved comments.
  'editorCommentsWidget.rangeBackground': ['bg-dim'], // Color of background for comment ranges.
  'editorCommentsWidget.rangeActiveBackground': ['bg-active'], // Color of background for currently selected or hovered comment range.
  'editorCommentsWidget.replyInputBackground': ['bg-dim'], // Background color for comment reply input box.

  // Editor inline edits can be seen when using Copilot to suggest the next change to make:

  'inlineEdit.gutterIndicator.primaryForeground': ['fg-main'], // Foreground color for the primary inline edit gutter indicator.
  'inlineEdit.gutterIndicator.primaryBackground': ['bg-main'], // Background color for the primary inline edit gutter indicator.
  'inlineEdit.gutterIndicator.secondaryForeground': ['fg-dim'], // Foreground color for the secondary inline edit gutter indicator.
  'inlineEdit.gutterIndicator.secondaryBackground': ['bg-dim'], // Background color for the secondary inline edit gutter indicator.
  'inlineEdit.gutterIndicator.successfulForeground': ['green'], // Foreground color for the successful inline edit gutter indicator.
  'inlineEdit.gutterIndicator.successfulBackground': ['bg-green-subtle'], // Background color for the successful inline edit gutter indicator.
  'inlineEdit.gutterIndicator.background': ['bg-main'], // Background color for the inline edit gutter indicator.
  'inlineEdit.indicator.foreground': ['fg-main'], // Foreground color for the inline edit indicator.
  'inlineEdit.indicator.background': ['bg-main'], // Background color for the inline edit indicator.
  'inlineEdit.indicator.border': ['border-mode-line-active'], // Border color for the inline edit indicator.
  'inlineEdit.originalBackground': ['bg-dim'], // Background color for the original text in inline edits.
  'inlineEdit.modifiedBackground': ['bg-active-item'], // Background color for the modified text in inline edits.
  'inlineEdit.originalChangedLineBackground': ['bg-inactive'], // Background color for the changed lines in the original text of inline edits.
  'inlineEdit.originalChangedTextBackground': ['bg-region'], // Overlay color for the changed text in the original text of inline edits.
  'inlineEdit.modifiedChangedLineBackground': ['bg-active'], // Background color for the changed lines in the modified text of inline edits.
  'inlineEdit.modifiedChangedTextBackground': ['bg-active-item'], // Overlay color for the changed text in the modified text of inline edits.
  'inlineEdit.originalBorder': ['border-region'], // Border color for the original text in inline edits.
  'inlineEdit.modifiedBorder': ['border-mode-line-active'], // Border color for the modified text in inline edits.
  'inlineEdit.tabWillAcceptBorder': ['border-mode-line-active'], // Border color for the inline edits widget over the original text when tab will accept it.
  'inlineEdit.wordReplacementView.background': ['bg-dim'], // Background color for the inline edit word replacement view.

  // Diff editor colors

  'diffEditor.insertedTextBackground': ['bg-green-subtle'], // Background color for text that got inserted. The color must not be opaque so as not to hide underlying decorations.
  'diffEditor.insertedTextBorder': ['green-warmer'], // Outline color for the text that got inserted.
  'diffEditor.removedTextBackground': ['bg-red-subtle'], // Background color for text that got removed. The color must not be opaque so as not to hide underlying decorations.
  'diffEditor.removedTextBorder': ['red-warmer'], // Outline color for text that got removed.
  'diffEditor.border': ['border-region'], // Border color between the two text editors.
  'diffEditor.diagonalFill': ['bg-inactive'], // Color of the diff editor's diagonal fill. The diagonal fill is used in side-by-side diff views.
  'diffEditor.insertedLineBackground': ['bg-green-subtle'], // Background color for lines that got inserted. The color must not be opaque so as not to hide underlying decorations.
  'diffEditor.removedLineBackground': ['bg-red-subtle'], // Background color for lines that got removed. The color must not be opaque so as not to hide underlying decorations.
  'diffEditorGutter.insertedLineBackground': ['bg-green-subtle'], // Background color for the margin where lines got inserted.
  'diffEditorGutter.removedLineBackground': ['bg-red-subtle'], // Background color for the margin where lines got removed.
  'diffEditorOverview.insertedForeground': ['green-warmer'], // Diff overview ruler foreground for inserted content.
  'diffEditorOverview.removedForeground': ['red-warmer'], // Diff overview ruler foreground for removed content.
  'diffEditor.unchangedRegionBackground': ['bg-dim'], // The color of unchanged blocks in diff editor.
  'diffEditor.unchangedRegionForeground': ['fg-dim'], // The foreground color of unchanged blocks in the diff editor.
  'diffEditor.unchangedRegionShadow': ['bg-dim'], // The color of the shadow around unchanged region widgets.
  'diffEditor.unchangedCodeBackground': ['bg-inactive'], // The background color of unchanged code in the diff editor.
  'diffEditor.move.border': ['yellow-warmer'], // The border color for text that got moved in the diff editor.
  'diffEditor.moveActive.border': ['yellow'], // The active border color for text that got moved in the diff editor.
  'multiDiffEditor.headerBackground': ['bg-alt'], // The background color of the diff editor's header
  'multiDiffEditor.background': ['bg-dim'], // The background color of the multi file diff editor
  'multiDiffEditor.border': ['border-region'], // The border color of the multi file diff editor

  // Chat colors

  'chat.requestBorder': ['border-region'], // The border color of a chat request.
  'chat.requestBackground': ['bg-dim'], // The background color of a chat request.
  'chat.slashCommandBackground': ['bg-inactive'], // The background color of a chat slash command.
  'chat.slashCommandForeground': ['fg-main'], // The foreground color of a chat slash command.
  'chat.avatarBackground': ['bg-active'], // The background color of a chat avatar.
  'chat.avatarForeground': ['fg-active'], // The foreground color of a chat avatar.
  'chat.editedFileForeground': ['fg-special-cold'], // The foreground color of a chat edited file in the edited file list.

  // Inline Chat colors

  'inlineChat.background': ['bg-dim'], // Background color of the interactive editor widget.
  'inlineChat.foreground': ['fg-main'], // Foreground color of the interactive editor widget
  'inlineChat.border': ['border-region'], // Border color of the interactive editor widget.
  'inlineChat.shadow': ['bg-dim'], // Shadow color of the interactive editor widget.
  'inlineChatInput.border': ['border-region'], // Border color of the interactive editor input.
  'inlineChatInput.focusBorder': ['border-mode-line-active'], // Border color of the interactive editor input when focused.
  'inlineChatInput.placeholderForeground': ['fg-dim'], // Foreground color of the interactive editor input placeholder.
  'inlineChatInput.background': ['bg-dim'], // Background color of the interactive editor input.
  'inlineChatDiff.inserted': ['bg-green-subtle'], // Background color of inserted text in the interactive editor input.
  'inlineChatDiff.removed': ['bg-red-subtle'], // Background color of removed text in the interactive editor input.

  // Panel Chat colors

  'interactive.activeCodeBorder': ['border-mode-line-active'], // The border color for the current interactive code cell when the editor has focus.
  'interactive.inactiveCodeBorder': ['border-mode-line-inactive'], // The border color for the current interactive code cell when the editor does not have focus.

  // Editor widget colors

  'editorWidget.foreground': ['fg-main'], // Foreground color of editor widgets, such as find/replace.
  'editorWidget.background': ['bg-dim'], // Background color of editor widgets, such as Find/Replace.
  'editorWidget.border': ['border-region'], // Border color of the editor widget unless the widget does not contain a border or defines its own border color.
  'editorWidget.resizeBorder': ['border-mode-line-active'], // Border color of the resize bar of editor widgets. The color is only used if the widget chooses to have a resize border and if the color is not overridden by a widget.
  'editorSuggestWidget.background': ['bg-dim'], // Background color of the suggestion widget.
  'editorSuggestWidget.border': ['border-region'], // Border color of the suggestion widget.
  'editorSuggestWidget.foreground': ['fg-main'], // Foreground color of the suggestion widget.
  'editorSuggestWidget.focusHighlightForeground': ['fg-active'], // Color of the match highlights in the suggest widget when an item is focused.
  'editorSuggestWidget.highlightForeground': ['fg-active'], // Color of the match highlights in the suggestion widget.
  'editorSuggestWidget.selectedBackground': ['bg-active-item'], // Background color of the selected entry in the suggestion widget.
  'editorSuggestWidget.selectedForeground': ['fg-active'], // Foreground color of the selected entry in the suggest widget.
  'editorSuggestWidget.selectedIconForeground': ['fg-active'], // Icon foreground color of the selected entry in the suggest widget.
  'editorSuggestWidgetStatus.foreground': ['fg-dim'], // Foreground color of the suggest widget status.
  'editorHoverWidget.foreground': ['fg-main'], // Foreground color of the editor hover.
  'editorHoverWidget.background': ['bg-dim'], // Background color of the editor hover.
  'editorHoverWidget.border': ['border-region'], // Border color of the editor hover.
  'editorHoverWidget.highlightForeground': ['fg-active'], // Foreground color of the active item in the parameter hint.
  'editorHoverWidget.statusBarBackground': ['bg-alt'], // Background color of the editor hover status bar.
  'editorGhostText.border': ['border-region'], // Border color of the ghost text shown by inline completion providers and the suggest preview.
  'editorGhostText.background': ['bg-inactive'], // Background color of the ghost text in the editor.
  'editorGhostText.foreground': ['fg-dim'], // Foreground color of the ghost text shown by inline completion providers and the suggest preview.
  'editorStickyScroll.background': ['bg-dim'], // Editor sticky scroll background color.
  'editorStickyScroll.border': ['border-region'], // Border color of sticky scroll in the editor.
  'editorStickyScroll.shadow': ['bg-dim'], // Shadow color of sticky scroll in the editor.
  'editorStickyScrollHover.background': ['bg-hover'], // Editor sticky scroll on hover background color.

  // The Debug Exception widget is a peek view that shows in the editor when debug stops at an exception.

  'debugExceptionWidget.background': ['bg-red-subtle'], // Exception widget background color.
  'debugExceptionWidget.border': ['red-warmer'], // Exception widget border color.

  // The editor marker view shows when navigating to errors and warnings in the editor (Go to Next Error or Warning command).

  'editorMarkerNavigation.background': ['bg-dim'], // Editor marker navigation widget background.
  'editorMarkerNavigationError.background': ['bg-red-subtle'], // Editor marker navigation widget error color.
  'editorMarkerNavigationWarning.background': ['bg-yellow-subtle'], // Editor marker navigation widget warning color.
  'editorMarkerNavigationInfo.background': ['bg-blue-subtle'], // Editor marker navigation widget info color.
  'editorMarkerNavigationError.headerBackground': ['bg-red-subtle'], // Editor marker navigation widget error heading background.
  'editorMarkerNavigationWarning.headerBackground': ['bg-yellow-subtle'], // Editor marker navigation widget warning heading background.
  'editorMarkerNavigationInfo.headerBackground': ['bg-blue-subtle'], // Editor marker navigation widget info heading background.

  // Peek view colors

  'peekView.border': ['border-region'], // Color of the peek view borders and arrow.
  'peekViewEditor.background': ['bg-dim'], // Background color of the peek view editor.
  'peekViewEditorGutter.background': ['bg-dim'], // Background color of the gutter in the peek view editor.
  'peekViewEditor.matchHighlightBackground': ['bg-search-lazy'], // Match highlight color in the peek view editor.
  'peekViewEditor.matchHighlightBorder': ['border-search-lazy'], // Match highlight border color in the peek view editor.
  'peekViewResult.background': ['bg-dim'], // Background color of the peek view result list.
  'peekViewResult.fileForeground': ['fg-special-cold'], // Foreground color for file nodes in the peek view result list.
  'peekViewResult.lineForeground': ['fg-main'], // Foreground color for line nodes in the peek view result list.
  'peekViewResult.matchHighlightBackground': ['bg-search-lazy'], // Match highlight color in the peek view result list.
  'peekViewResult.selectionBackground': ['bg-active-item'], // Background color of the selected entry in the peek view result list.
  'peekViewResult.selectionForeground': ['fg-active'], // Foreground color of the selected entry in the peek view result list.
  'peekViewTitle.background': ['bg-alt'], // Background color of the peek view title area.
  'peekViewTitleDescription.foreground': ['fg-dim'], // Color of the peek view title info.
  'peekViewTitleLabel.foreground': ['fg-main'], // Color of the peek view title.
  'peekViewEditorStickyScroll.background': ['bg-dim'], // Background color of sticky scroll in the peek view editor.

  // Merge conflicts colors

  'merge.currentHeaderBackground': ['bg-blue-subtle'], // Current header background in inline merge conflicts. The color must not be opaque so as not to hide underlying decorations.
  'merge.currentContentBackground': ['bg-blue-subtle'], // Current content background in inline merge conflicts. The color must not be opaque so as not to hide underlying decorations.
  'merge.incomingHeaderBackground': ['bg-green-subtle'], // Incoming header background in inline merge conflicts. The color must not be opaque so as not to hide underlying decorations.
  'merge.incomingContentBackground': ['bg-green-subtle'], // Incoming content background in inline merge conflicts. The color must not be opaque so as not to hide underlying decorations.
  'merge.border': ['border-region'], // Border color on headers and the splitter in inline merge conflicts.
  'merge.commonContentBackground': ['bg-inactive'], // Common ancestor content background in inline merge-conflicts. The color must not be opaque so as not to hide underlying decorations.
  'merge.commonHeaderBackground': ['bg-inactive'], // Common ancestor header background in inline merge-conflicts. The color must not be opaque so as not to hide underlying decorations.
  'editorOverviewRuler.currentContentForeground': ['blue'], // Current overview ruler foreground for inline merge conflicts.
  'editorOverviewRuler.incomingContentForeground': ['green'], // Incoming overview ruler foreground for inline merge conflicts.
  'editorOverviewRuler.commonContentForeground': ['fg-dim'], // Common ancestor overview ruler foreground for inline merge conflicts.
  'editorOverviewRuler.commentForeground': ['fg-comment'], // Editor overview ruler decoration color for resolved comments. This color should be opaque.
  'editorOverviewRuler.commentUnresolvedForeground': ['yellow-warmer'], // Editor overview ruler decoration color for unresolved comments. This color should be opaque.
  'mergeEditor.change.background': ['bg-inactive'], // The background color for changes.
  'mergeEditor.change.word.background': ['bg-region'], // The background color for word changes.
  'mergeEditor.conflict.unhandledUnfocused.border': ['yellow-warmer'], // The border color of unhandled unfocused conflicts.
  'mergeEditor.conflict.unhandledFocused.border': ['yellow'], // The border color of unhandled focused conflicts.
  'mergeEditor.conflict.handledUnfocused.border': ['green-warmer'], // The border color of handled unfocused conflicts.
  'mergeEditor.conflict.handledFocused.border': ['green'], // The border color of handled focused conflicts.
  'mergeEditor.conflict.handled.minimapOverViewRuler': ['green'], // The foreground color for changes in input 1.
  'mergeEditor.conflict.unhandled.minimapOverViewRuler': ['yellow'], // The foreground color for changes in input 1.
  'mergeEditor.conflictingLines.background': ['bg-inactive'], // The background of the "Conflicting Lines" text.
  'mergeEditor.changeBase.background': ['bg-inactive'], // The background color for changes in base.
  'mergeEditor.changeBase.word.background': ['bg-region'], // The background color for word changes in base.
  'mergeEditor.conflict.input1.background': ['bg-blue-subtle'], // The background color of decorations in input 1.
  'mergeEditor.conflict.input2.background': ['bg-green-subtle'], // The background color of decorations in input 2.

  // Panel colors

  'panel.background': ['bg-dim'], // Panel background color.
  'panel.border': ['border-region'], // Panel border color to separate the panel from the editor.
  'panel.dropBorder': ['border-mode-line-active'], // Drag and drop feedback color for the panel titles. Panels are shown below the editor area and contain views like output and integrated terminal.
  'panelTitle.activeBorder': ['border-mode-line-active'], // Border color for the active panel title.
  'panelTitle.activeForeground': ['fg-main'], // Title color for the active panel.
  'panelTitle.inactiveForeground': ['fg-dim'], // Title color for the inactive panel.
  'panelTitle.border': ['border-region'], // Panel title border color on the bottom, separating the title from the views. Panels are shown below the editor area and contain views like output and integrated terminal.
  'panelTitleBadge.background': ['bg-active'], // Panel title badge background color. Panels are shown below the editor area and contain views like output and integrated terminal.
  'panelTitleBadge.foreground': ['fg-active'], // Panel title badge foreground color. Panels are shown below the editor area and contain views like output and integrated terminal.
  'panelInput.border': ['border-region'], // Input box border for inputs in the panel.
  'panelSection.border': ['border-region'], // Panel section border color used when multiple views are stacked horizontally in the panel. Panels are shown below the editor area and contain views like output and integrated terminal.
  'panelSection.dropBackground': ['bg-dim'], // Drag and drop feedback color for the panel sections. The color should have transparency so that the panel sections can still shine through. Panels are shown below the editor area and contain views like output and integrated terminal.
  'panelSectionHeader.background': ['bg-alt'], // Panel section header background color. Panels are shown below the editor area and contain views like output and integrated terminal.
  'panelSectionHeader.foreground': ['fg-special-cold'], // Panel section header foreground color. Panels are shown below the editor area and contain views like output and integrated terminal.
  'panelStickyScroll.background': ['bg-dim'], // Background color of sticky scroll in the panel.
  'panelStickyScroll.border': ['border-region'], // Border color of sticky scroll in the panel.
  'panelStickyScroll.shadow': ['bg-dim'], // Shadow color of sticky scroll in the panel.
  'panelSectionHeader.border': ['border-region'], // Panel section header border color used when multiple views are stacked vertically in the panel. Panels are shown below the editor area and contain views like output and integrated terminal.
  'outputView.background': ['bg-dim'], // Output view background color.
  'outputViewStickyScroll.background': ['bg-dim'], // Output view sticky scroll background color.

  // Status Bar colors

  'statusBar.background': ['bg-mode-line-inactive'], // Standard Status Bar background color.
  'statusBar.foreground': ['fg-main'], // Status Bar foreground color.
  'statusBar.border': ['border-mode-line-inactive'], // Status Bar border color separating the Status Bar and editor.
  'statusBar.debuggingBackground': ['bg-yellow-subtle'], // Status Bar background color when a program is being debugged.
  'statusBar.debuggingForeground': ['fg-main'], // Status Bar foreground color when a program is being debugged.
  'statusBar.debuggingBorder': ['yellow-warmer'], // Status Bar border color separating the Status Bar and editor when a program is being debugged.
  'statusBar.noFolderForeground': ['fg-main'], // Status Bar foreground color when no folder is opened.
  'statusBar.noFolderBackground': ['bg-inactive'], // Status Bar background color when no folder is opened.
  'statusBar.noFolderBorder': ['border-region'], // Status Bar border color separating the Status Bar and editor when no folder is opened.
  'statusBarItem.activeBackground': ['bg-active'], // Status Bar item background color when clicking.
  'statusBarItem.hoverForeground': ['fg-main'], // Status bar item foreground color when hovering. The status bar is shown in the bottom of the window.
  'statusBarItem.hoverBackground': ['bg-hover'], // Status Bar item background color when hovering.
  'statusBarItem.prominentForeground': ['fg-active'], // Status Bar prominent items foreground color.
  'statusBarItem.prominentBackground': ['bg-active'], // Status Bar prominent items background color.
  'statusBarItem.prominentHoverForeground': ['fg-active'], // Status bar prominent items foreground color when hovering. Prominent items stand out from other status bar entries to indicate importance. The status bar is shown in the bottom of the window.
  'statusBarItem.prominentHoverBackground': ['bg-active-item'], // Status Bar prominent items background color when hovering.
  'statusBarItem.remoteBackground': ['bg-blue-subtle'], // Background color for the remote indicator on the status bar.
  'statusBarItem.remoteForeground': ['fg-main'], // Foreground color for the remote indicator on the status bar.
  'statusBarItem.remoteHoverBackground': ['bg-blue-intense'], // Background color for the remote indicator on the status bar when hovering.
  'statusBarItem.remoteHoverForeground': ['fg-main'], // Foreground color for the remote indicator on the status bar when hovering.
  'statusBarItem.errorBackground': ['bg-red-subtle'], // Status bar error items background color. Error items stand out from other status bar entries to indicate error conditions.
  'statusBarItem.errorForeground': ['fg-main'], // Status bar error items foreground color. Error items stand out from other status bar entries to indicate error conditions.
  'statusBarItem.errorHoverBackground': ['bg-red-intense'], // Status bar error items background color when hovering. Error items stand out from other status bar entries to indicate error conditions. The status bar is shown in the bottom of the window.
  'statusBarItem.errorHoverForeground': ['fg-main'], // Status bar error items foreground color when hovering. Error items stand out from other status bar entries to indicate error conditions. The status bar is shown in the bottom of the window.
  'statusBarItem.warningBackground': ['bg-yellow-subtle'], // Status bar warning items background color. Warning items stand out from other status bar entries to indicate warning conditions. The status bar is shown in the bottom of the window.
  'statusBarItem.warningForeground': ['fg-main'], // Status bar warning items foreground color. Warning items stand out from other status bar entries to indicate warning conditions. The status bar is shown in the bottom of the window.
  'statusBarItem.warningHoverBackground': ['bg-yellow-intense'], // Status bar warning items background color when hovering. Warning items stand out from other status bar entries to indicate warning conditions. The status bar is shown in the bottom of the window.
  'statusBarItem.warningHoverForeground': ['fg-main'], // Status bar warning items foreground color when hovering. Warning items stand out from other status bar entries to indicate warning conditions. The status bar is shown in the bottom of the window.
  'statusBarItem.compactHoverBackground': ['bg-hover'], // Status bar item background color when hovering an item that contains two hovers. The status bar is shown in the bottom of the window.
  'statusBarItem.focusBorder': ['border-mode-line-active'], // Status bar item border color when focused on keyboard navigation. The status bar is shown in the bottom of the window.
  'statusBar.focusBorder': ['border-mode-line-active'], // Status bar border color when focused on keyboard navigation. The status bar is shown in the bottom of the window.
  'statusBarItem.offlineBackground': ['bg-inactive'], // Status bar item background color when the workbench is offline.
  'statusBarItem.offlineForeground': ['fg-dim'], // Status bar item foreground color when the workbench is offline.
  'statusBarItem.offlineHoverForeground': ['fg-main'], // Status bar item foreground hover color when the workbench is offline.
  'statusBarItem.offlineHoverBackground': ['bg-hover'], // Status bar item background hover color when the workbench is offline.

  // Prominent items stand out from other Status Bar entries to indicate importance. One example is the Toggle Tab Key Moves Focus command change mode indicator.
  'titleBar.activeBackground': ['bg-mode-line-inactive'], // Title Bar background when the window is active.
  'titleBar.activeForeground': ['fg-main'], // Title Bar foreground when the window is active.
  'titleBar.inactiveBackground': ['bg-inactive'], // Title Bar background when the window is inactive.
  'titleBar.inactiveForeground': ['fg-dim'], // Title Bar foreground when the window is inactive.
  'titleBar.border': ['border-mode-line-inactive'], // Title bar border color.

  // Menu Bar colors

  'menubar.selectionForeground': ['fg-active'], // Foreground color of the selected menu item in the menubar.
  'menubar.selectionBackground': ['bg-active'], // Background color of the selected menu item in the menubar.
  'menubar.selectionBorder': ['border-mode-line-active'], // Border color of the selected menu item in the menubar.
  'menu.foreground': ['fg-main'], // Foreground color of menu items.
  'menu.background': ['bg-dim'], // Background color of menu items.
  'menu.selectionForeground': ['fg-active'], // Foreground color of the selected menu item in menus.
  'menu.selectionBackground': ['bg-active'], // Background color of the selected menu item in menus.
  'menu.selectionBorder': ['border-mode-line-active'], // Border color of the selected menu item in menus.
  'menu.separatorBackground': ['border-region'], // Color of a separator menu item in menus.
  'menu.border': ['border-region'], // Border color of menus.

  // Command Center colors

  'commandCenter.foreground': ['fg-main'], // Foreground color of the Command Center.
  'commandCenter.activeForeground': ['fg-active'], // Active foreground color of the Command Center.
  'commandCenter.background': ['bg-dim'], // Background color of the Command Center.
  'commandCenter.activeBackground': ['bg-active'], // Active background color of the Command Center.
  'commandCenter.border': ['border-region'], // Border color of the Command Center.
  'commandCenter.inactiveForeground': ['fg-dim'], // Foreground color of the Command Center when the window is inactive.
  'commandCenter.inactiveBorder': ['border-mode-line-inactive'], // Border color of the Command Center when the window is inactive.
  'commandCenter.activeBorder': ['border-mode-line-active'], // Active border color of the Command Center.
  'commandCenter.debuggingBackground': ['bg-yellow-subtle'], // Command Center background color when a program is being debugged.

  // Notification colors

  'notificationCenter.border': ['border-region'], // Notification Center border color.
  'notificationCenterHeader.foreground': ['fg-special-cold'], // Notification Center header foreground color.
  'notificationCenterHeader.background': ['bg-alt'], // Notification Center header background color.
  'notificationToast.border': ['border-region'], // Notification toast border color.
  'notifications.foreground': ['fg-main'], // Notification foreground color.
  'notifications.background': ['bg-dim'], // Notification background color.
  'notifications.border': ['border-region'], // Notification border color separating from other notifications in the Notification Center.
  'notificationLink.foreground': ['fg-link'], // Notification links foreground color.
  'notificationsErrorIcon.foreground': ['red'], // The color used for the notification error icon.
  'notificationsWarningIcon.foreground': ['yellow'], // The color used for the notification warning icon.
  'notificationsInfoIcon.foreground': ['blue'], // The color used for the notification info icon.

  // Banner colors

  'banner.background': ['bg-inactive'], // Banner background color.
  'banner.foreground': ['fg-main'], // Banner foreground color.
  'banner.iconForeground': ['fg-special-cold'], // Color for the icon in front of the banner text.

  // Extensions colors

  'extensionButton.prominentForeground': ['fg-active'], // Extension view button foreground color (for example Install button).
  'extensionButton.prominentBackground': ['bg-active'], // Extension view button background color.
  'extensionButton.prominentHoverBackground': ['bg-active-item'], // Extension view button background hover color.
  'extensionButton.background': ['bg-dim'], // Button background color for extension actions.
  'extensionButton.foreground': ['fg-main'], // Button foreground color for extension actions.
  'extensionButton.hoverBackground': ['bg-hover'], // Button background hover color for extension actions.
  'extensionButton.separator': ['fg-dim'], // Button separator color for extension actions.
  'extensionBadge.remoteBackground': ['bg-blue-subtle'], // Background color for the remote badge in the extensions view.
  'extensionBadge.remoteForeground': ['fg-main'], // Foreground color for the remote badge in the extensions view.
  'extensionIcon.starForeground': ['yellow'], // The icon color for extension ratings.
  'extensionIcon.verifiedForeground': ['green'], // The icon color for extension verified publisher.
  'extensionIcon.preReleaseForeground': ['yellow-warmer'], // The icon color for pre-release extension.
  'extensionIcon.sponsorForeground': ['magenta'], // The icon color for extension sponsor.

  // Quick picker colors

  'pickerGroup.border': ['border-region'], // Quick picker (Quick Open) color for grouping borders.
  'pickerGroup.foreground': ['fg-special-cold'], // Quick picker (Quick Open) color for grouping labels.
  'quickInput.background': ['bg-dim'], // Quick input background color. The quick input widget is the container for views like the color theme picker.
  'quickInput.foreground': ['fg-main'], // Quick input foreground color. The quick input widget is the container for views like the color theme picker.
  'quickInputList.focusBackground': ['bg-active-item'], // Quick picker background color for the focused item.
  'quickInputList.focusForeground': ['fg-active'], // Quick picker foreground color for the focused item.
  'quickInputList.focusIconForeground': ['fg-active'], // Quick picker icon foreground color for the focused item.
  'quickInputTitle.background': ['bg-alt'], // Quick picker title background color. The quick picker widget is the container for pickers like the Command Palette.

  // Keybinding label colors

  'keybindingLabel.background': ['bg-dim'], // Keybinding label background color. The keybinding label is used to represent a keyboard shortcut.
  'keybindingLabel.foreground': ['fg-main'], // Keybinding label foreground color. The keybinding label is used to represent a keyboard shortcut.
  'keybindingLabel.border': ['border-region'], // Keybinding label border color. The keybinding label is used to represent a keyboard shortcut.
  'keybindingLabel.bottomBorder': ['border-region'], // Keybinding label border bottom color. The keybinding label is used to represent a keyboard shortcut.

  // Keyboard shortcut table colors

  'keybindingTable.headerBackground': ['bg-alt'], // Background color for the keyboard shortcuts table header.
  'keybindingTable.rowsBackground': ['bg-inactive'], // Background color for the keyboard shortcuts table alternating rows.

  // Integrated Terminal colors

  'terminal.background': ['bg-main'], // The background of the Integrated Terminal's viewport.
  'terminal.border': ['border-region'], // The color of the border that separates split panes within the terminal. This defaults to panel.border.
  'terminal.foreground': ['fg-main'], // The default foreground color of the Integrated Terminal.
  'terminal.ansiBlack': ['bg-dim'], // 'Black' ANSI color in the terminal.
  'terminal.ansiBlue': ['blue'], // 'Blue' ANSI color in the terminal.
  'terminal.ansiBrightBlack': ['fg-dim'], // 'BrightBlack' ANSI color in the terminal.
  'terminal.ansiBrightBlue': ['blue-intense'], // 'BrightBlue' ANSI color in the terminal.
  'terminal.ansiBrightCyan': ['cyan-intense'], // 'BrightCyan' ANSI color in the terminal.
  'terminal.ansiBrightGreen': ['green-intense'], // 'BrightGreen' ANSI color in the terminal.
  'terminal.ansiBrightMagenta': ['magenta-intense'], // 'BrightMagenta' ANSI color in the terminal.
  'terminal.ansiBrightRed': ['red-intense'], // 'BrightRed' ANSI color in the terminal.
  'terminal.ansiBrightWhite': ['fg-main-intense'], // 'BrightWhite' ANSI color in the terminal.
  'terminal.ansiBrightYellow': ['yellow-intense'], // 'BrightYellow' ANSI color in the terminal.
  'terminal.ansiCyan': ['cyan'], // 'Cyan' ANSI color in the terminal.
  'terminal.ansiGreen': ['green'], // 'Green' ANSI color in the terminal.
  'terminal.ansiMagenta': ['magenta'], // 'Magenta' ANSI color in the terminal.
  'terminal.ansiRed': ['red'], // 'Red' ANSI color in the terminal.
  'terminal.ansiWhite': ['fg-main'], // 'White' ANSI color in the terminal.
  'terminal.ansiYellow': ['yellow'], // 'Yellow' ANSI color in the terminal.
  'terminal.selectionBackground': ['bg-region'], // The selection background color of the terminal.
  'terminal.selectionForeground': ['fg-main'], // The selection foreground color of the terminal. When this is null the selection foreground will be retained and have the minimum contrast ratio feature applied.
  'terminal.inactiveSelectionBackground': ['bg-inactive'], // The selection background color of the terminal when it does not have focus.
  'terminal.findMatchBackground': ['bg-search-lazy'], // Color of the current search match in the terminal. The color must not be opaque so as not to hide underlying terminal content.
  'terminal.findMatchBorder': ['border-search-lazy'], // Border color of the current search match in the terminal.
  'terminal.findMatchHighlightBackground': ['bg-search-lazy'], // Color of the other search matches in the terminal. The color must not be opaque so as not to hide underlying terminal content.
  'terminal.findMatchHighlightBorder': ['border-search-lazy'], // Border color of the other search matches in the terminal.
  'terminal.hoverHighlightBackground': ['bg-hover'], // Color of the highlight when hovering a link in the terminal.
  'terminalCursor.background': ['bg-main'], // The background color of the terminal cursor. Allows customizing the color of a character overlapped by a block cursor.
  'terminalCursor.foreground': ['fg-main'], // The foreground color of the terminal cursor.
  'terminal.dropBackground': ['bg-dim'], // The background color when dragging on top of terminals. The color should have transparency so that the terminal contents can still shine through.
  'terminal.tab.activeBorder': ['border-mode-line-active'], // Border on the side of the terminal tab in the panel. This defaults to tab.activeBorder.
  'terminalCommandDecoration.defaultBackground': ['bg-alt'], // The default terminal command decoration background color.
  'terminalCommandDecoration.successBackground': ['green-warmer'], // The terminal command decoration background color for successful commands.
  'terminalCommandDecoration.errorBackground': ['red-warmer'], // The terminal command decoration background color for error commands.
  'terminalOverviewRuler.cursorForeground': ['fg-main'], // The overview ruler cursor color.
  'terminalOverviewRuler.findMatchForeground': ['fg-search-lazy'], // Overview ruler marker color for find matches in the terminal.
  'terminalStickyScroll.background': ['bg-dim'], // The background color of the sticky scroll overlay in the terminal.
  'terminalStickyScroll.border': ['border-region'], // The border of the sticky scroll overlay in the terminal.
  'terminalStickyScrollHover.background': ['bg-hover'], // The background color of the sticky scroll overlay in the terminal when hovered.
  'terminal.initialHintForeground': ['fg-dim'], // Foreground color of the terminal initial hint.
  'terminalOverviewRuler.border': ['border-region'], // The overview ruler left-side border color.
  'terminalCommandGuide.foreground': ['fg-dim'], // The foreground color of the terminal command guide that appears to the left of a command and its output on hover.
  'terminalSymbolIcon.aliasForeground': ['fg-special-warm'], // The foreground color for an alias icon. These icons will appear in the terminal suggest widget
  'terminalSymbolIcon.flagForeground': ['fg-special-cold'], // The foreground color for an flag icon. These icons will appear in the terminal suggest widget

  // Debug colors

  'debugToolBar.background': ['bg-dim'], // Debug toolbar background color.
  'debugToolBar.border': ['border-region'], // Debug toolbar border color.
  'editor.stackFrameHighlightBackground': ['bg-yellow-subtle'], // Background color of the top stack frame highlight in the editor.
  'editor.focusedStackFrameHighlightBackground': ['bg-yellow-intense'], // Background color of the focused stack frame highlight in the editor.
  'editor.inlineValuesForeground': ['fg-special-cold'], // Color for the debug inline value text.
  'editor.inlineValuesBackground': ['bg-dim'], // Color for the debug inline value background.
  'debugView.exceptionLabelForeground': ['fg-main'], // Foreground color for a label shown in the CALL STACK view when the debugger breaks on an exception.
  'debugView.exceptionLabelBackground': ['bg-red-subtle'], // Background color for a label shown in the CALL STACK view when the debugger breaks on an exception.
  'debugView.stateLabelForeground': ['fg-main'], // Foreground color for a label in the CALL STACK view showing the current session's or thread's state.
  'debugView.stateLabelBackground': ['bg-alt'], // Background color for a label in the CALL STACK view showing the current session's or thread's state.
  'debugView.valueChangedHighlight': ['yellow-warmer'], // Color used to highlight value changes in the debug views (such as in the Variables view).
  'debugTokenExpression.name': ['fg-special-cold'], // Foreground color for the token names shown in debug views (such as in the Variables or Watch view).
  'debugTokenExpression.value': ['fg-main'], // Foreground color for the token values shown in debug views.
  'debugTokenExpression.string': ['blue-cooler'], // Foreground color for strings in debug views.
  'debugTokenExpression.boolean': ['magenta-warmer'], // Foreground color for booleans in debug views.
  'debugTokenExpression.number': ['blue'], // Foreground color for numbers in debug views.
  'debugTokenExpression.error': ['red'], // Foreground color for expression errors in debug views.
  'debugTokenExpression.type': ['magenta'], // Foreground color for the token types shown in the debug views (ie. the Variables or Watch view).

  // Testing colors

  'testing.runAction': ['fg-main'], // Color for 'run' icons in the editor.
  'testing.iconErrored': ['red'], // Color for the 'Errored' icon in the test explorer.
  'testing.iconFailed': ['red-warmer'], // Color for the 'failed' icon in the test explorer.
  'testing.iconPassed': ['green'], // Color for the 'passed' icon in the test explorer.
  'testing.iconQueued': ['fg-dim'], // Color for the 'Queued' icon in the test explorer.
  'testing.iconUnset': ['fg-dim'], // Color for the 'Unset' icon in the test explorer.
  'testing.iconSkipped': ['yellow'], // Color for the 'Skipped' icon in the test explorer.
  'testing.iconErrored.retired': ['red'], // Retired color for the 'Errored' icon in the test explorer.
  'testing.iconFailed.retired': ['red-warmer'], // Retired color for the 'failed' icon in the test explorer.
  'testing.iconPassed.retired': ['green'], // Retired color for the 'passed' icon in the test explorer.
  'testing.iconQueued.retired': ['fg-dim'], // Retired color for the 'Queued' icon in the test explorer.
  'testing.iconUnset.retired': ['fg-dim'], // Retired color for the 'Unset' icon in the test explorer.
  'testing.iconSkipped.retired': ['yellow'], // Retired color for the 'Skipped' icon in the test explorer.
  'testing.peekBorder': ['border-region'], // Color of the peek view borders and arrow.
  'testing.peekHeaderBackground': ['bg-alt'], // Color of the peek view borders and arrow.
  'testing.message.error.lineBackground': ['bg-red-subtle'], // Margin color beside error messages shown inline in the editor.
  'testing.message.info.decorationForeground': ['blue'], // Text color of test info messages shown inline in the editor.
  'testing.message.info.lineBackground': ['bg-blue-subtle'], // Margin color beside info messages shown inline in the editor.
  'testing.messagePeekBorder': ['border-region'], // Color of the peek view borders and arrow when peeking a logged message.
  'testing.messagePeekHeaderBackground': ['bg-alt'], // Color of the peek view borders and arrow when peeking a logged message.
  'testing.coveredBackground': ['bg-green-subtle'], // Background color of text that was covered.
  'testing.coveredBorder': ['green-warmer'], // Border color of text that was covered.
  'testing.coveredGutterBackground': ['green-warmer'], // Gutter color of regions where code was covered.
  'testing.uncoveredBranchBackground': ['bg-yellow-subtle'], // Background of the widget shown for an uncovered branch.
  'testing.uncoveredBackground': ['bg-red-subtle'], // Background color of text that was not covered.
  'testing.uncoveredBorder': ['red-warmer'], // Border color of text that was not covered.
  'testing.uncoveredGutterBackground': ['red-warmer'], // Gutter color of regions where code not covered.
  'testing.coverCountBadgeBackground': ['bg-inactive'], // Background for the badge indicating execution count
  'testing.coverCountBadgeForeground': ['fg-main'], // Foreground for the badge indicating execution count
  'testing.message.error.badgeBackground': ['bg-red-subtle'], // Background color of test error messages shown inline in the editor.
  'testing.message.error.badgeBorder': ['red-warmer'], // Border color of test error messages shown inline in the editor.
  'testing.message.error.badgeForeground': ['fg-main'], // Text color of test error messages shown inline in the editor.

  // Welcome page colors

  'welcomePage.background': ['bg-main'], // Background color for the Welcome page.
  'welcomePage.progress.background': ['bg-dim'], // Foreground color for the Welcome page progress bars.
  'welcomePage.progress.foreground': ['fg-main'], // Background color for the Welcome page progress bars.
  'welcomePage.tileBackground': ['bg-dim'], // Background color for the tiles on the Welcome page.
  'welcomePage.tileHoverBackground': ['bg-hover'], // Hover background color for the tiles on the Welcome page.
  'welcomePage.tileBorder': ['border-region'], // Border color for the tiles on the Welcome page.
  'walkThrough.embeddedEditorBackground': ['bg-dim'], // Background color for the embedded editors on the Interactive Playground.
  'walkthrough.stepTitle.foreground': ['fg-special-cold'], // Foreground color of the heading of each walkthrough step.

  // Git colors

  'gitDecoration.addedResourceForeground': ['green'], // Color for added Git resources. Used for file labels and the SCM viewlet.
  'gitDecoration.modifiedResourceForeground': ['yellow'], // Color for modified Git resources. Used for file labels and the SCM viewlet.
  'gitDecoration.deletedResourceForeground': ['red'], // Color for deleted Git resources. Used for file labels and the SCM viewlet.
  'gitDecoration.renamedResourceForeground': ['blue'], // Color for renamed or copied Git resources. Used for file labels and the SCM viewlet.
  'gitDecoration.stageModifiedResourceForeground': ['yellow-warmer'], // Color for staged modifications git decorations. Used for file labels and the SCM viewlet.
  'gitDecoration.stageDeletedResourceForeground': ['red-warmer'], // Color for staged deletions git decorations. Used for file labels and the SCM viewlet.
  'gitDecoration.untrackedResourceForeground': ['cyan'], // Color for untracked Git resources. Used for file labels and the SCM viewlet.
  'gitDecoration.ignoredResourceForeground': ['fg-dim'], // Color for ignored Git resources. Used for file labels and the SCM viewlet.
  'gitDecoration.conflictingResourceForeground': ['magenta-warmer'], // Color for conflicting Git resources. Used for file labels and the SCM viewlet.
  'gitDecoration.submoduleResourceForeground': ['fg-special-warm'], // Color for submodule resources.
  'git.blame.editorDecorationForeground': ['fg-dim'], // Color for the blame editor decoration.

  // Source Control Graph colors

  'scmGraph.historyItemHoverLabelForeground': ['fg-main'], // History item hover label foreground color.
  'scmGraph.foreground1': ['red'], // Source control graph foreground color (1).
  'scmGraph.foreground2': ['green'], // Source control graph foreground color (2).
  'scmGraph.foreground3': ['yellow'], // Source control graph foreground color (3).
  'scmGraph.foreground4': ['blue'], // Source control graph foreground color (4).
  'scmGraph.foreground5': ['magenta'], // Source control graph foreground color (5).
  'scmGraph.historyItemHoverAdditionsForeground': ['green'], // History item hover additions foreground color.
  'scmGraph.historyItemHoverDeletionsForeground': ['red'], // History item hover deletions foreground color.
  'scmGraph.historyItemRefColor': ['fg-main'], // History item reference color.
  'scmGraph.historyItemRemoteRefColor': ['fg-special-cold'], // History item remote reference color.
  'scmGraph.historyItemBaseRefColor': ['fg-special-warm'], // History item base reference color.
  'scmGraph.historyItemHoverDefaultLabelForeground': ['fg-main'], // History item hover default label foreground color.
  'scmGraph.historyItemHoverDefaultLabelBackground': ['bg-dim'], // History item hover default label background color.

  // Settings Editor colors

  'settings.headerForeground': ['fg-special-cold'], // The foreground color for a section header or active title.
  'settings.modifiedItemIndicator': ['yellow-warmer'], // The line that indicates a modified setting.
  'settings.dropdownBackground': ['bg-dim'], // Dropdown background.
  'settings.dropdownForeground': ['fg-main'], // Dropdown foreground.
  'settings.dropdownBorder': ['border-region'], // Dropdown border.
  'settings.dropdownListBorder': ['border-region'], // Dropdown list border.
  'settings.checkboxBackground': ['bg-inactive'], // Checkbox background.
  'settings.checkboxForeground': ['fg-main'], // Checkbox foreground.
  'settings.checkboxBorder': ['border-region'], // Checkbox border.
  'settings.rowHoverBackground': ['bg-hover'], // The background color of a settings row when hovered.
  'settings.textInputBackground': ['bg-dim'], // Text input box background.
  'settings.textInputForeground': ['fg-main'], // Text input box foreground.
  'settings.textInputBorder': ['border-region'], // Text input box border.
  'settings.numberInputBackground': ['bg-dim'], // Number input box background.
  'settings.numberInputForeground': ['fg-main'], // Number input box foreground.
  'settings.numberInputBorder': ['border-region'], // Number input box border.
  'settings.focusedRowBackground': ['bg-active'], // Background color of a focused setting row.
  'settings.focusedRowBorder': ['border-mode-line-active'], // The color of the row's top and bottom border when the row is focused.
  'settings.headerBorder': ['border-region'], // The color of the header container border.
  'settings.sashBorder': ['border-region'], // The color of the Settings editor splitview sash border.
  'settings.settingsHeaderHoverForeground': ['fg-main'], // The foreground color for a section header or hovered title.

  // Breadcrumbs colors

  'breadcrumb.foreground': ['fg-dim'], // Color of breadcrumb items.
  'breadcrumb.background': ['bg-main'], // Background color of breadcrumb items.
  'breadcrumb.focusForeground': ['fg-main'], // Color of focused breadcrumb items.
  'breadcrumb.activeSelectionForeground': ['fg-active'], // Color of selected breadcrumb items.
  'breadcrumbPicker.background': ['bg-dim'], // Background color of breadcrumb item picker.

  // Snippets colors

  'editor.snippetTabstopHighlightBackground': ['bg-blue-subtle'], // Highlight background color of a snippet tabstop.
  'editor.snippetTabstopHighlightBorder': ['blue-warmer'], // Highlight border color of a snippet tabstop.
  'editor.snippetFinalTabstopHighlightBackground': ['bg-green-subtle'], // Highlight background color of the final tabstop of a snippet.
  'editor.snippetFinalTabstopHighlightBorder': ['green-warmer'], // Highlight border color of the final tabstop of a snippet.

  // Symbol Icons colors

  'symbolIcon.arrayForeground': ['blue'], // The foreground color for array symbols.
  'symbolIcon.booleanForeground': ['magenta-warmer'], // The foreground color for boolean symbols.
  'symbolIcon.classForeground': ['yellow-warmer'], // The foreground color for class symbols.
  'symbolIcon.colorForeground': ['fg-main'], // The foreground color for color symbols.
  'symbolIcon.constantForeground': ['cyan-cooler'], // The foreground color for constant symbols.
  'symbolIcon.constructorForeground': ['red'], // The foreground color for constructor symbols.
  'symbolIcon.enumeratorForeground': ['yellow'], // The foreground color for enumerator symbols.
  'symbolIcon.enumeratorMemberForeground': ['yellow'], // The foreground color for enumerator member symbols.
  'symbolIcon.eventForeground': ['magenta'], // The foreground color for event symbols.
  'symbolIcon.fieldForeground': ['fg-special-mild'], // The foreground color for field symbols.
  'symbolIcon.fileForeground': ['fg-main'], // The foreground color for file symbols.
  'symbolIcon.folderForeground': ['fg-main'], // The foreground color for folder symbols.
  'symbolIcon.functionForeground': ['red'], // The foreground color for function symbols.
  'symbolIcon.interfaceForeground': ['yellow-warmer'], // The foreground color for interface symbols.
  'symbolIcon.keyForeground': ['fg-special-mild'], // The foreground color for key symbols.
  'symbolIcon.keywordForeground': ['magenta-warmer'], // The foreground color for keyword symbols.
  'symbolIcon.methodForeground': ['red'], // The foreground color for method symbols.
  'symbolIcon.moduleForeground': ['blue'], // The foreground color for module symbols.
  'symbolIcon.namespaceForeground': ['blue'], // The foreground color for namespace symbols.
  'symbolIcon.nullForeground': ['magenta-warmer'], // The foreground color for null symbols.
  'symbolIcon.numberForeground': ['blue'], // The foreground color for number symbols.
  'symbolIcon.objectForeground': ['yellow-warmer'], // The foreground color for object symbols.
  'symbolIcon.operatorForeground': ['magenta-warmer'], // The foreground color for operator symbols.
  'symbolIcon.packageForeground': ['blue'], // The foreground color for package symbols.
  'symbolIcon.propertyForeground': ['fg-special-cold'], // The foreground color for property symbols.
  'symbolIcon.referenceForeground': ['fg-special-mild'], // The foreground color for reference symbols.
  'symbolIcon.snippetForeground': ['green'], // The foreground color for snippet symbols.
  'symbolIcon.stringForeground': ['blue-cooler'], // The foreground color for string symbols.
  'symbolIcon.structForeground': ['yellow-warmer'], // The foreground color for struct symbols.
  'symbolIcon.textForeground': ['fg-main'], // The foreground color for text symbols.
  'symbolIcon.typeParameterForeground': ['magenta'], // The foreground color for type parameter symbols.
  'symbolIcon.unitForeground': ['fg-special-mild'], // The foreground color for unit symbols.
  'symbolIcon.variableForeground': ['fg-main'], // The foreground color for variable symbols.

  // Debug Icons colors

  'debugIcon.breakpointForeground': ['red'], // Icon color for breakpoints.
  'debugIcon.breakpointDisabledForeground': ['red-warmer'], // Icon color for disabled breakpoints.
  'debugIcon.breakpointUnverifiedForeground': ['fg-dim'], // Icon color for unverified breakpoints.
  'debugIcon.breakpointCurrentStackframeForeground': ['yellow'], // Icon color for the current breakpoint stack frame.
  'debugIcon.breakpointStackframeForeground': ['yellow-warmer'], // Icon color for all breakpoint stack frames.
  'debugIcon.startForeground': ['green'], // Debug toolbar icon for start debugging.
  'debugIcon.pauseForeground': ['yellow'], // Debug toolbar icon for pause.
  'debugIcon.stopForeground': ['red'], // Debug toolbar icon for stop.
  'debugIcon.disconnectForeground': ['red-warmer'], // Debug toolbar icon for disconnect.
  'debugIcon.restartForeground': ['green'], // Debug toolbar icon for restart.
  'debugIcon.stepOverForeground': ['blue'], // Debug toolbar icon for step over.
  'debugIcon.stepIntoForeground': ['blue-warmer'], // Debug toolbar icon for step into.
  'debugIcon.stepOutForeground': ['blue-cooler'], // Debug toolbar icon for step over.
  'debugIcon.continueForeground': ['green'], // Debug toolbar icon for continue.
  'debugIcon.stepBackForeground': ['cyan'], // Debug toolbar icon for step back.
  'debugConsole.infoForeground': ['blue'], // Foreground color for info messages in debug REPL console.
  'debugConsole.warningForeground': ['yellow'], // Foreground color for warning messages in debug REPL console.
  'debugConsole.errorForeground': ['red'], // Foreground color for error messages in debug REPL console.
  'debugConsole.sourceForeground': ['fg-special-cold'], // Foreground color for source filenames in debug REPL console.
  'debugConsoleInputIcon.foreground': ['fg-main'], // Foreground color for debug console input marker icon.

  // Notebook colors

  'notebook.editorBackground': ['bg-main'], // Notebook background color.
  'notebook.cellBorderColor': ['border-region'], // The border color for notebook cells.
  'notebook.cellHoverBackground': ['bg-hover'], // The background color of a cell when the cell is hovered.
  'notebook.cellInsertionIndicator': ['border-mode-line-active'], // The color of the notebook cell insertion indicator.
  'notebook.cellStatusBarItemHoverBackground': ['bg-hover'], // The background color of notebook cell status bar items.
  'notebook.cellToolbarSeparator': ['border-region'], // The color of the separator in the cell bottom toolbar
  'notebook.cellEditorBackground': ['bg-main'], // The color of the notebook cell editor background
  'notebook.focusedCellBackground': ['bg-inactive'], // The background color of a cell when the cell is focused.
  'notebook.focusedCellBorder': ['border-mode-line-active'], // The color of the cell's focus indicator borders when the cell is focused.
  'notebook.focusedEditorBorder': ['border-mode-line-active'], // The color of the notebook cell editor border.
  'notebook.inactiveFocusedCellBorder': ['border-mode-line-inactive'], // The color of the cell's top and bottom border when a cell is focused while the primary focus is outside of the editor.
  'notebook.inactiveSelectedCellBorder': ['border-mode-line-inactive'], // The color of the cell's borders when multiple cells are selected.
  'notebook.outputContainerBackgroundColor': ['bg-dim'], // The Color of the notebook output container background.
  'notebook.outputContainerBorderColor': ['border-region'], // The border color of the notebook output container.
  'notebook.selectedCellBackground': ['bg-active'], // The background color of a cell when the cell is selected.
  'notebook.selectedCellBorder': ['border-mode-line-active'], // The color of the cell's top and bottom border when the cell is selected but not focused.
  'notebook.symbolHighlightBackground': ['bg-region'], // Background color of highlighted cell
  'notebookScrollbarSlider.activeBackground': ['bg-scroll-active'], // Notebook scrollbar slider background color when clicked on.
  'notebookScrollbarSlider.background': ['bg-scroll'], // Notebook scrollbar slider background color.
  'notebookScrollbarSlider.hoverBackground': ['bg-scroll-hover'], // Notebook scrollbar slider background color when hovering.
  'notebookStatusErrorIcon.foreground': ['red'], // The error icon color of notebook cells in the cell status bar.
  'notebookStatusRunningIcon.foreground': ['blue'], // The running icon color of notebook cells in the cell status bar.
  'notebookStatusSuccessIcon.foreground': ['green'], // The success icon color of notebook cells in the cell status bar.
  'notebookEditorOverviewRuler.runningCellForeground': ['blue'], // The color of the running cell decoration in the notebook editor overview ruler.

  // Chart colors

  'charts.foreground': ['fg-main'], // Contrast color for text in charts.
  'charts.lines': ['fg-dim'], // Color for lines in charts.
  'charts.red': ['red'], // Color for red elements in charts.
  'charts.blue': ['blue'], // Color for blue elements in charts.
  'charts.yellow': ['yellow'], // Color for yellow elements in charts.
  'charts.orange': ['red-warmer'], // Color for orange elements in charts.
  'charts.green': ['green'], // Color for green elements in charts.
  'charts.purple': ['magenta'], // Color for purple elements in charts.
  'chart.line': ['fg-dim'], // Line color for the chart.
  'chart.axis': ['fg-dim'], // Axis color for the chart.
  'chart.guide': ['fg-dim'], // Guide line for the chart.

  // Ports colors

  'ports.iconRunningProcessForeground': ['green'], // The color of the icon for a port that has an associated running process.

  // Comments View colors

  'commentsView.resolvedIcon': ['green'], // Icon color for resolved comments.
  'commentsView.unresolvedIcon': ['yellow'], // Icon color for unresolved comments.

  // Action Bar colors

  'actionBar.toggledBackground': ['bg-active'], // Background color for toggled action items in action bar.

  // Simple Find Widget colors

  'simpleFindWidget.sashBorder': ['border-region'], // Border color of the sash border.

  // Gauge colors

  'gauge.background': ['bg-inactive'], // Gauge background color.
  'gauge.foreground': ['fg-main'], // Gauge foreground color.
  'gauge.border': ['border-region'], // Gauge border color.
  'gauge.warningBackground': ['bg-yellow-subtle'], // Gauge warning background color.
  'gauge.warningForeground': ['fg-main'], // Gauge warning foreground color.
  'gauge.errorBackground': ['bg-red-subtle'], // Gauge error background color.
  'gauge.errorForeground': ['fg-main'], // Gauge error foreground color.

  // Extension colors

  'extensionColors': ['bg-main'], // Color IDs can also be contributed by extensions through the color contribution point. These colors also appear when using code complete in the workbench.colorCustomizations settings and the color theme definition file. Users can see what colors an extension defines in the extension contributions tab.
};

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
  })
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
  private readonly THEME_SPECIFIC_OVERRIDES: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
    'comment': Object.freeze({
      'default': 'fg-dim',
      'modus-operandi-tinted': 'red-faint',
      'modus-vivendi-tinted': 'red-faint',
      'modus-operandi-deuteranopia': 'blue-faint',
      'modus-vivendi-deuteranopia': 'blue-faint',
      'modus-operandi-tritanopia': 'magenta-faint',
      'modus-vivendi-tritanopia': 'magenta-faint'
    }),
    'keyword': Object.freeze({
      'default': 'magenta-cooler',
      'modus-operandi-deuteranopia': 'blue-intense',
      'modus-vivendi-deuteranopia': 'blue-intense',
      'modus-operandi-tritanopia': 'magenta-intense',
      'modus-vivendi-tritanopia': 'magenta-intense'
    }),
    'string': Object.freeze({
      'default': 'blue-warmer',
      'modus-operandi-deuteranopia': 'cyan',
      'modus-vivendi-deuteranopia': 'cyan',
      'modus-operandi-tritanopia': 'blue-cooler',
      'modus-vivendi-tritanopia': 'blue-cooler'
    }),
    'entity.name.function': Object.freeze({
      'default': 'magenta',
      'modus-operandi-deuteranopia': 'blue',
      'modus-vivendi-deuteranopia': 'blue',
      'modus-operandi-tritanopia': 'magenta-intense',
      'modus-vivendi-tritanopia': 'magenta-intense'
    }),
    'entity.name.type': Object.freeze({
      'default': 'cyan-cooler',
      'modus-operandi-deuteranopia': 'blue-cooler',
      'modus-vivendi-deuteranopia': 'blue-cooler',
      'modus-operandi-tritanopia': 'cyan-cooler',
      'modus-vivendi-tritanopia': 'cyan-cooler'
    })
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
      const { boldKeywords, italicComments, useSemanticHighlighting } = config;

      const getColor = (colorName: string): string => {
        const resolvedColor = this.parser.resolveColor(colorName, palette);
        if (!resolvedColor) {
          throw new ThemeGenerationError(`Missing color: ${colorName} in theme ${id}`);
        }
        return resolvedColor;
      };

      const colors: Record<string, string> = {};
      for (const [vscodeId, modusColors] of Object.entries(VS_CODE_UI_MAPPINGS)) {
        if (modusColors.length > 0) {
          colors[vscodeId] = getColor(modusColors[0]);
        }
      }

      const tokenColors: ITokenStyle[] = [];
      this.processCommentTokens(tokenColors, palette, id, type, italicComments, getColor);

      const scopesByColor = new Map<string, string[]>();
      for (const [scope, colorNames] of Object.entries(TEXTMATE_SCOPE_MAPPINGS)) {
        // Special case: Comments are already handled
        if (scope === 'comment' || scope === 'punctuation.definition.comment') {
          continue;
        }

        const overrides = this.THEME_SPECIFIC_OVERRIDES[scope];
        let colorName: string;

        if (overrides && overrides[id]) {
          colorName = overrides[id];
          this.logger.debug(`Applied theme-specific override for ${scope} in ${id}: ${colorName}`);
        } else if (overrides && overrides['default']) {
          colorName = overrides['default'];
        } else if (colorNames.length > 0) {
          colorName = colorNames[0];
        } else {
          continue; // No mapping found
        }

        if (!scopesByColor.has(colorName)) {
          scopesByColor.set(colorName, []);
        }
        scopesByColor.get(colorName)!.push(scope);
      }

      // Generate token colors for each color group
      for (const [colorName, scopes] of scopesByColor.entries()) {
        const foreground = getColor(colorName);

        let fontStyle = '';
        if (boldKeywords &&
          (colorName === 'magenta-cooler' || colorName === 'magenta-warmer')) {
          fontStyle = 'bold';
        }

        tokenColors.push({
          scope: scopes,
          settings: {
            foreground,
            fontStyle: fontStyle || undefined
          }
        });
      }

      this.logger.info(`Generated theme: ${name}`);

      return Object.freeze({
        name,
        type,
        colors: Object.freeze(colors),
        tokenColors: Object.freeze(tokenColors),
        semanticHighlighting: useSemanticHighlighting
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
   * Process comment tokens with theme-specific overrides
   * @private
   * @param tokenColors - Token colors array to append to
   * @param palette - Color palette
   * @param themeId - Theme identifier
   * @param themeType - Theme type (light/dark)
   * @param italicComments - Whether to use italic styling for comments
   * @param getColor - Function to resolve colors
   */
  private processCommentTokens(
    tokenColors: ITokenStyle[],
    palette: IColorPalette,
    themeId: string,
    themeType: ThemeType,
    italicComments: boolean,
    getColor: (name: string) => string
  ): void {
    const commentOverrides = this.THEME_SPECIFIC_OVERRIDES['comment'] || {};
    const colorName = commentOverrides[themeId] || commentOverrides['default'] || 'fg-dim';
    const commentColor = getColor(colorName);

    if (commentOverrides[themeId]) {
      this.logger.debug(`Applied theme-specific comment color for ${themeId}: ${colorName} (${commentColor})`);
    }

    tokenColors.push({
      scope: ['comment', 'punctuation.definition.comment'],
      settings: {
        foreground: commentColor,
        fontStyle: italicComments ? 'italic' : undefined
      }
    });
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
