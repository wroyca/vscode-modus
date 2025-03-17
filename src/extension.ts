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
      const overrides = config.get<Record<string, string>>('colorOverrides', {});
      const colorOverrides = new Map<string, string>();

      for (const [key, value] of Object.entries(overrides)) {
        colorOverrides.set(key, value);
      }

      return {
        colorOverrides,
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
 * Tokens auto-generated from https://code.visualstudio.com/api/language-extensions/semantic-highlight-guide#standard-token-types-and-modifiers
 *
 * @const
 * @readonly
 */
const TEXTMATE: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'comment': Object.freeze(['fg-dim']), // For tokens that represent a comment.
  'string': Object.freeze(['blue-warmer']), // For tokens that represent a string literal.
  'keyword': Object.freeze(['magenta-cooler']), // For tokens that represent a language keyword.
});

/**
 * VS Code UI color mappings
 *
 * Tokens auto-generated from https://code.visualstudio.com/api/references/theme-color
 *
 * NOTE: Values are currently placeholders and need to be updated.
 *
 * @const
 * @readonly
 */
const EDITOR: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // Contrast colors
  //
  // The contrast colors are typically only set for high contrast themes. If
  // set, they add an additional border around items across the UI to increase
  // the contrast.
  //
  'contrastActiveBorder': Object.freeze(['']), // An extra border around active elements to separate them from others for greater contrast.
  'contrastBorder': Object.freeze(['']), // An extra border around elements to separate them from others for greater contrast.

  // Base colors
  //
  'focusBorder': Object.freeze(['bg-active-argument']), // Overall border color for focused elements. This color is only used if not overridden by a component.
  'foreground': Object.freeze(['fg-main']), // Overall foreground color. This color is only used if not overridden by a component.
  'disabledForeground': Object.freeze(['fg-dim']), // Overall foreground for disabled elements. This color is only used if not overridden by a component.
  'widget.border': Object.freeze(['border']), // Border color of widgets such as Find/Replace inside the editor.
  'widget.shadow': Object.freeze(['bg-dim']), // Shadow color of widgets such as Find/Replace inside the editor.
  'selection.background': Object.freeze(['bg-active']), // Background color of text selections in the workbench (for input fields or text areas, does not apply to selections within the editor and the terminal).
  'descriptionForeground': Object.freeze(['fg-alt']), // Foreground color for description text providing additional information, for example for a label.
  'errorForeground': Object.freeze(['red']), // Overall foreground color for error messages (this color is only used if not overridden by a component).
  'icon.foreground': Object.freeze(['fg-main']), // The default color for icons in the workbench.
  'sash.hoverBorder': Object.freeze(['blue-intense']), // The hover border color for draggable sashes.

  // Window border
  //
  'window.activeBorder': Object.freeze(['border']), // Border color for the active (focused) window.
  'window.inactiveBorder': Object.freeze(['border-mode-line-active']), // Border color for the inactive (unfocused) windows.

  // Text colors
  //
  'textBlockQuote.background': Object.freeze(['bg-dim']), // Background color for block quotes in text.
  'textBlockQuote.border': Object.freeze(['border']), // Border color for block quotes in text.
  'textCodeBlock.background': Object.freeze(['bg-active-argument']), // Background color for code blocks in text.
  'textLink.activeForeground': Object.freeze(['blue-intense']), // Foreground color for links in text when clicked on and on mouse hover.
  'textLink.foreground': Object.freeze(['blue']), // Foreground color for links in text.
  'textPreformat.foreground': Object.freeze(['magenta']), // Foreground color for preformatted text segments.
  'textPreformat.background': Object.freeze(['bg-active-argument']), // Background color for preformatted text segments.
  'textSeparator.foreground': Object.freeze(['fg-dim']), // Color for text separators.

  // Action colors
  //
  'toolbar.hoverBackground': Object.freeze(['bg-hover']), // Toolbar background when hovering over actions using the mouse
  'toolbar.hoverOutline': Object.freeze(['border']), // Toolbar outline when hovering over actions using the mouse
  'toolbar.activeBackground': Object.freeze(['bg-active']), // Toolbar background when holding the mouse over actions
  'editorActionList.background': Object.freeze(['bg-dim']), // Action List background color.
  'editorActionList.foreground': Object.freeze(['fg-main']), // Action List foreground color.
  'editorActionList.focusForeground': Object.freeze(['fg-main']), // Action List foreground color for the focused item.
  'editorActionList.focusBackground': Object.freeze(['bg-active']), // Action List background color for the focused item.

  // Button control
  //
  'button.background': Object.freeze(['bg-active']), // Button background color.
  'button.foreground': Object.freeze(['fg-main']), // Button foreground color.
  'button.border': Object.freeze(['border']), // Button border color.
  'button.separator': Object.freeze(['border']), // Button separator color.
  'button.hoverBackground': Object.freeze(['bg-active-argument']), // Button background color when hovering.
  'button.secondaryForeground': Object.freeze(['fg-main']), // Secondary button foreground color.
  'button.secondaryBackground': Object.freeze(['bg-active-argument']), // Secondary button background color.
  'button.secondaryHoverBackground': Object.freeze(['bg-hover']), // Secondary button background color when hovering.
  'checkbox.background': Object.freeze(['bg-main']), // Background color of checkbox widget.
  'checkbox.foreground': Object.freeze(['fg-main']), // Foreground color of checkbox widget.
  'checkbox.border': Object.freeze(['border']), // Border color of checkbox widget.
  'checkbox.selectBackground': Object.freeze(['bg-active']), // Background color of checkbox widget when the element it's in is selected.
  'checkbox.selectBorder': Object.freeze(['border']), // Border color of checkbox widget when the element it's in is selected.
  'radio.activeForeground': Object.freeze(['fg-main']), // Foreground color of active radio option.
  'radio.activeBackground': Object.freeze(['bg-active']), // Background color of active radio option.
  'radio.activeBorder': Object.freeze(['border']), // Border color of the active radio option.
  'radio.inactiveForeground': Object.freeze(['fg-dim']), // Foreground color of inactive radio option.
  'radio.inactiveBackground': Object.freeze(['bg-main']), // Background color of inactive radio option.
  'radio.inactiveBorder': Object.freeze(['border']), // Border color of the inactive radio option.
  'radio.inactiveHoverBackground': Object.freeze(['bg-hover']), // Background color of inactive active radio option when hovering.

  // Dropdown control
  //
  'dropdown.background': Object.freeze(['bg-main']), // Dropdown background.
  'dropdown.listBackground': Object.freeze(['bg-main']), // Dropdown list background.
  'dropdown.border': Object.freeze(['border']), // Dropdown border.
  'dropdown.foreground': Object.freeze(['fg-main']), // Dropdown foreground.

  // Input control
  //
  'input.background': Object.freeze(['bg-main']), // Input box background.
  'input.foreground': Object.freeze(['fg-main']), // Input box foreground.
  'input.border': Object.freeze(['border']), // Input box border.
  'input.placeholderForeground': Object.freeze(['fg-dim']), // Input box foreground color for placeholder text.
  'inputOption.activeBackground': Object.freeze(['bg-active']), // Background color of activated options in input fields.
  'inputOption.activeBorder': Object.freeze(['border']), // Border color of activated options in input fields.
  'inputOption.activeForeground': Object.freeze(['fg-main']), // Foreground color of activated options in input fields.
  'inputOption.hoverBackground': Object.freeze(['bg-hover']), // Background color of activated options in input fields when hovered.
  'inputValidation.errorBackground': Object.freeze(['bg-red-subtle']), // Input validation background color for error severity.
  'inputValidation.errorForeground': Object.freeze(['fg-main']), // Input validation foreground color for error severity.
  'inputValidation.errorBorder': Object.freeze(['red']), // Input validation border color for error severity.
  'inputValidation.infoBackground': Object.freeze(['bg-blue-subtle']), // Input validation background color for information severity.
  'inputValidation.infoForeground': Object.freeze(['fg-main']), // Input validation foreground color for information severity.
  'inputValidation.infoBorder': Object.freeze(['blue']), // Input validation border color for information severity.
  'inputValidation.warningBackground': Object.freeze(['bg-yellow-subtle']), // Input validation background color for information warning.
  'inputValidation.warningForeground': Object.freeze(['fg-main']), // Input validation foreground color for warning severity.
  'inputValidation.warningBorder': Object.freeze(['yellow']), // Input validation border color for warning severity.

  // Scrollbar control
  //
  'scrollbar.shadow': Object.freeze(['bg-dim']), // Scrollbar slider shadow to indicate that the view is scrolled.
  'scrollbarSlider.activeBackground': Object.freeze(['bg-active']), // Scrollbar slider background color when clicked on.
  'scrollbarSlider.background': Object.freeze(['bg-inactive']), // Scrollbar slider background color.
  'scrollbarSlider.hoverBackground': Object.freeze(['bg-hover']), // Scrollbar slider background color when hovering.

  // Badge
  //
  'badge.foreground': Object.freeze(['fg-main']), // Badge foreground color.
  'badge.background': Object.freeze(['bg-active-argument']), // Badge background color.

  // Progress bar
  //
  'progressBar.background': Object.freeze(['blue-intense']), // Background color of the progress bar shown for long running operations.

  // Lists and trees
  //
  'list.activeSelectionBackground': Object.freeze(['bg-active']), // List/Tree background color for the selected item when the list/tree is active.
  'list.activeSelectionForeground': Object.freeze(['fg-main']), // List/Tree foreground color for the selected item when the list/tree is active.
  'list.activeSelectionIconForeground': Object.freeze(['fg-main']), // List/Tree icon foreground color for the selected item when the list/tree is active. An active list/tree has keyboard focus, an inactive does not.
  'list.dropBackground': Object.freeze(['bg-dim']), // List/Tree drag and drop background when moving items around using the mouse.
  'list.focusBackground': Object.freeze(['bg-active']), // List/Tree background color for the focused item when the list/tree is active.
  'list.focusForeground': Object.freeze(['fg-main']), // List/Tree foreground color for the focused item when the list/tree is active. An active list/tree has keyboard focus, an inactive does not.
  'list.focusHighlightForeground': Object.freeze(['blue-intense']), // List/Tree foreground color of the match highlights on actively focused items when searching inside the list/tree.
  'list.focusOutline': Object.freeze(['border']), // List/Tree outline color for the focused item when the list/tree is active. An active list/tree has keyboard focus, an inactive does not.
  'list.focusAndSelectionOutline': Object.freeze(['blue-intense']), // List/Tree outline color for the focused item when the list/tree is active and selected. An active list/tree has keyboard focus, an inactive does not.
  'list.highlightForeground': Object.freeze(['blue']), // List/Tree foreground color of the match highlights when searching inside the list/tree.
  'list.hoverBackground': Object.freeze(['bg-hover']), // List/Tree background when hovering over items using the mouse.
  'list.hoverForeground': Object.freeze(['fg-main']), // List/Tree foreground when hovering over items using the mouse.
  'list.inactiveSelectionBackground': Object.freeze(['bg-inactive']), // List/Tree background color for the selected item when the list/tree is inactive.
  'list.inactiveSelectionForeground': Object.freeze(['fg-main']), // List/Tree foreground color for the selected item when the list/tree is inactive. An active list/tree has keyboard focus, an inactive does not.
  'list.inactiveSelectionIconForeground': Object.freeze(['fg-dim']), // List/Tree icon foreground color for the selected item when the list/tree is inactive. An active list/tree has keyboard focus, an inactive does not.
  'list.inactiveFocusBackground': Object.freeze(['bg-inactive']), // List background color for the focused item when the list is inactive. An active list has keyboard focus, an inactive does not. Currently only supported in lists.
  'list.inactiveFocusOutline': Object.freeze(['border']), // List/Tree outline color for the focused item when the list/tree is inactive. An active list/tree has keyboard focus, an inactive does not.
  'list.invalidItemForeground': Object.freeze(['red']), // List/Tree foreground color for invalid items, for example an unresolved root in explorer.
  'list.errorForeground': Object.freeze(['red']), // Foreground color of list items containing errors.
  'list.warningForeground': Object.freeze(['yellow']), // Foreground color of list items containing warnings.
  'listFilterWidget.background': Object.freeze(['bg-dim']), // List/Tree Filter background color of typed text when searching inside the list/tree.
  'listFilterWidget.outline': Object.freeze(['border']), // List/Tree Filter Widget's outline color of typed text when searching inside the list/tree.
  'listFilterWidget.noMatchesOutline': Object.freeze(['red']), // List/Tree Filter Widget's outline color when no match is found of typed text when searching inside the list/tree.
  'listFilterWidget.shadow': Object.freeze(['bg-dim']), // Shadow color of the type filter widget in lists and tree.
  'list.filterMatchBackground': Object.freeze(['bg-search-current']), // Background color of the filtered matches in lists and trees.
  'list.filterMatchBorder': Object.freeze(['border']), // Border color of the filtered matches in lists and trees.
  'list.deemphasizedForeground': Object.freeze(['fg-dim']), // List/Tree foreground color for items that are deemphasized.
  'list.dropBetweenBackground': Object.freeze(['bg-blue-subtle']), // List/Tree drag and drop border color when moving items between items when using the mouse.
  'tree.indentGuidesStroke': Object.freeze(['border']), // Tree Widget's stroke color for indent guides.
  'tree.inactiveIndentGuidesStroke': Object.freeze(['border-mode-line-active']), // Tree stroke color for the indentation guides that are not active.
  'tree.tableColumnsBorder': Object.freeze(['border']), // Tree stroke color for the indentation guides.
  'tree.tableOddRowsBackground': Object.freeze(['bg-active-argument']), // Background color for odd table rows.

  // Activity Bar
  //
  // The Activity Bar is usually displayed either on the far left or right of
  // the workbench and allows fast switching between views of the Side Bar.
  //
  'activityBar.background': Object.freeze(['bg-dim']), // Activity Bar background color.
  'activityBar.dropBorder': Object.freeze(['blue']), // Drag and drop feedback color for the activity bar items. The activity bar is showing on the far left or right and allows to switch between views of the side bar.
  'activityBar.foreground': Object.freeze(['fg-main']), // Activity Bar foreground color (for example used for the icons).
  'activityBar.inactiveForeground': Object.freeze(['fg-dim']), // Activity Bar item foreground color when it is inactive.
  'activityBar.border': Object.freeze(['border']), // Activity Bar border color with the Side Bar.
  'activityBarBadge.background': Object.freeze(['bg-active-argument']), // Activity notification badge background color.
  'activityBarBadge.foreground': Object.freeze(['fg-main']), // Activity notification badge foreground color.
  'activityBar.activeBorder': Object.freeze(['blue-intense']), // Activity Bar active indicator border color.
  'activityBar.activeBackground': Object.freeze(['bg-active']), // Activity Bar optional background color for the active element.
  'activityBar.activeFocusBorder': Object.freeze(['blue']), // Activity bar focus border color for the active item.
  'activityBarTop.foreground': Object.freeze(['fg-main']), // Active foreground color of the item in the Activity bar when it is on top. The activity allows to switch between views of the side bar.
  'activityBarTop.activeBorder': Object.freeze(['blue-intense']), // Focus border color for the active item in the Activity bar when it is on top. The activity allows to switch between views of the side bar.
  'activityBarTop.inactiveForeground': Object.freeze(['fg-dim']), // Inactive foreground color of the item in the Activity bar when it is on top. The activity allows to switch between views of the side bar.
  'activityBarTop.dropBorder': Object.freeze(['blue']), // Drag and drop feedback color for the items in the Activity bar when it is on top. The activity allows to switch between views of the side bar.
  'activityBarTop.background': Object.freeze(['bg-dim']), // Background color of the activity bar when set to top / bottom.
  'activityBarTop.activeBackground': Object.freeze(['bg-active']), // Background color for the active item in the Activity bar when it is on top / bottom. The activity allows to switch between views of the side bar.
  'activityWarningBadge.foreground': Object.freeze(['fg-main']), // Foreground color of the warning activity badge
  'activityWarningBadge.background': Object.freeze(['yellow']), // Background color of the warning activity badge
  'activityErrorBadge.foreground': Object.freeze(['fg-main']), // Foreground color of the error activity badge
  'activityErrorBadge.background': Object.freeze(['red']), // Background color of the error activity badge

  // Profiles
  //
  'profileBadge.background': Object.freeze(['bg-blue-subtle']), // Profile badge background color. The profile badge shows on top of the settings gear icon in the activity bar.
  'profileBadge.foreground': Object.freeze(['fg-main']), // Profile badge foreground color. The profile badge shows on top of the settings gear icon in the activity bar.
  'profiles.sashBorder': Object.freeze(['border']), // The color of the Profiles editor splitview sash border.

  // Side Bar
  //
  // The Side Bar contains views like the Explorer and Search.
  //
  'sideBar.background': Object.freeze(['bg-dim']), // Side Bar background color.
  'sideBar.foreground': Object.freeze(['fg-main']), // Side Bar foreground color. The Side Bar is the container for views like Explorer and Search.
  'sideBar.border': Object.freeze(['border']), // Side Bar border color on the side separating the editor.
  'sideBar.dropBackground': Object.freeze(['bg-inactive']), // Drag and drop feedback color for the side bar sections. The color should have transparency so that the side bar sections can still shine through.
  'sideBarTitle.foreground': Object.freeze(['fg-main']), // Side Bar title foreground color.
  'sideBarSectionHeader.background': Object.freeze(['bg-dim']), // Side Bar section header background color.
  'sideBarSectionHeader.foreground': Object.freeze(['fg-main']), // Side Bar section header foreground color.
  'sideBarSectionHeader.border': Object.freeze(['border']), // Side bar section header border color.
  'sideBarActivityBarTop.border': Object.freeze(['border']), // Border color between the activity bar at the top/bottom and the views.
  'sideBarTitle.background': Object.freeze(['bg-dim']), // Side bar title background color. The side bar is the container for views like explorer and search.
  'sideBarTitle.border': Object.freeze(['border']), // Side bar title border color on the bottom, separating the title from the views. The side bar is the container for views like explorer and search.
  'sideBarStickyScroll.background': Object.freeze(['bg-dim']), // Background color of sticky scroll in the side bar.
  'sideBarStickyScroll.border': Object.freeze(['border']), // Border color of sticky scroll in the side bar.
  'sideBarStickyScroll.shadow': Object.freeze(['bg-dim']), // Shadow color of sticky scroll in the side bar.

  // Minimap
  //
  // The Minimap shows a minified version of the current file.
  //
  'minimap.findMatchHighlight': Object.freeze(['bg-search-current']), // Highlight color for matches from search within files.
  'minimap.selectionHighlight': Object.freeze(['bg-active']), // Highlight color for the editor selection.
  'minimap.errorHighlight': Object.freeze(['bg-red-subtle']), // Highlight color for errors within the editor.
  'minimap.warningHighlight': Object.freeze(['bg-yellow-subtle']), // Highlight color for warnings within the editor.
  'minimap.background': Object.freeze(['bg-active-argument']), // Minimap background color.
  'minimap.selectionOccurrenceHighlight': Object.freeze(['bg-inactive']), // Minimap marker color for repeating editor selections.
  'minimap.foregroundOpacity': Object.freeze(['']), // Opacity of foreground elements rendered in the minimap. For example, "#000000c0" will render the elements with 75% opacity.
  'minimap.infoHighlight': Object.freeze(['bg-blue-subtle']), // Minimap marker color for infos.
  'minimap.chatEditHighlight': Object.freeze(['bg-green-subtle']), // Color of pending edit regions in the minimap.
  'minimapSlider.background': Object.freeze(['bg-inactive']), // Minimap slider background color.
  'minimapSlider.hoverBackground': Object.freeze(['bg-hover']), // Minimap slider background color when hovering.
  'minimapSlider.activeBackground': Object.freeze(['bg-active']), // Minimap slider background color when clicked on.
  'minimapGutter.addedBackground': Object.freeze(['green']), // Minimap gutter color for added content.
  'minimapGutter.modifiedBackground': Object.freeze(['yellow']), // Minimap gutter color for modified content.
  'minimapGutter.deletedBackground': Object.freeze(['red']), // Minimap gutter color for deleted content.
  'editorMinimap.inlineChatInserted': Object.freeze(['bg-green-subtle']), // Minimap marker color for inline chat inserted content.

  // Editor Groups & Tabs
  //
  // Editor Groups are the containers of editors. There can be many editor
  // groups. A Tab is the container of an editor. Multiple Tabs can be opened in
  // one editor group.
  //
  'editorGroup.border': Object.freeze(['border']), // Color to separate multiple editor groups from each other.
  'editorGroup.dropBackground': Object.freeze(['bg-inactive']), // Background color when dragging editors around.
  'editorGroupHeader.noTabsBackground': Object.freeze(['bg-dim']), // Background color of the editor group title header when using single Tab (set "workbench.editor.showTabs": "single").
  'editorGroupHeader.tabsBackground': Object.freeze(['bg-dim']), // Background color of the Tabs container.
  'editorGroupHeader.tabsBorder': Object.freeze(['border']), // Border color below the editor tabs control when tabs are enabled.
  'editorGroupHeader.border': Object.freeze(['border']), // Border color between editor group header and editor (below breadcrumbs if enabled).
  'editorGroup.emptyBackground': Object.freeze(['bg-main']), // Background color of an empty editor group.
  'editorGroup.focusedEmptyBorder': Object.freeze(['border']), // Border color of an empty editor group that is focused.
  'editorGroup.dropIntoPromptForeground': Object.freeze(['fg-main']), // Foreground color of text shown over editors when dragging files. This text informs the user that they can hold shift to drop into the editor.
  'editorGroup.dropIntoPromptBackground': Object.freeze(['bg-inactive']), // Background color of text shown over editors when dragging files. This text informs the user that they can hold shift to drop into the editor.
  'editorGroup.dropIntoPromptBorder': Object.freeze(['border']), // Border color of text shown over editors when dragging files. This text informs the user that they can hold shift to drop into the editor.
  'tab.activeBackground': Object.freeze(['bg-main']), // Active Tab background color in an active group.
  'tab.unfocusedActiveBackground': Object.freeze(['bg-active-argument']), // Active Tab background color in an inactive editor group.
  'tab.activeForeground': Object.freeze(['fg-main']), // Active Tab foreground color in an active group.
  'tab.border': Object.freeze(['border']), // Border to separate Tabs from each other.
  'tab.activeBorder': Object.freeze(['blue']), // Bottom border for the active tab.
  'tab.selectedBorderTop': Object.freeze(['blue-intense']), // Border to the top of a selected tab. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups.
  'tab.selectedBackground': Object.freeze(['bg-active']), // Background of a selected tab. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups.
  'tab.selectedForeground': Object.freeze(['fg-main']), // Foreground of a selected tab. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups.
  'tab.dragAndDropBorder': Object.freeze(['blue']), // Border between tabs to indicate that a tab can be inserted between two tabs. Tabs are the containers for editors in the editor area. Multiple tabs can be opened in one editor group. There can be multiple editor groups.
  'tab.unfocusedActiveBorder': Object.freeze(['border-mode-line-active']), // Bottom border for the active tab in an inactive editor group.
  'tab.activeBorderTop': Object.freeze(['blue-intense']), // Top border for the active tab.
  'tab.unfocusedActiveBorderTop': Object.freeze(['border-mode-line-active']), // Top border for the active tab in an inactive editor group
  'tab.lastPinnedBorder': Object.freeze(['border']), // Border on the right of the last pinned editor to separate from unpinned editors.
  'tab.inactiveBackground': Object.freeze(['bg-dim']), // Inactive Tab background color.
  'tab.unfocusedInactiveBackground': Object.freeze(['bg-dim']), // Inactive Tab background color in an unfocused group
  'tab.inactiveForeground': Object.freeze(['fg-dim']), // Inactive Tab foreground color in an active group.
  'tab.unfocusedActiveForeground': Object.freeze(['fg-dim']), // Active tab foreground color in an inactive editor group.
  'tab.unfocusedInactiveForeground': Object.freeze(['fg-dim']), // Inactive tab foreground color in an inactive editor group.
  'tab.hoverBackground': Object.freeze(['bg-hover']), // Tab background color when hovering
  'tab.unfocusedHoverBackground': Object.freeze(['bg-hover']), // Tab background color in an unfocused group when hovering
  'tab.hoverForeground': Object.freeze(['fg-main']), // Tab foreground color when hovering
  'tab.unfocusedHoverForeground': Object.freeze(['fg-dim']), // Tab foreground color in an unfocused group when hovering
  'tab.hoverBorder': Object.freeze(['blue']), // Border to highlight tabs when hovering
  'tab.unfocusedHoverBorder': Object.freeze(['border-mode-line-active']), // Border to highlight tabs in an unfocused group when hovering
  'tab.activeModifiedBorder': Object.freeze(['yellow']), // Border on the top of modified (dirty) active tabs in an active group.
  'tab.inactiveModifiedBorder': Object.freeze(['yellow-faint']), // Border on the top of modified (dirty) inactive tabs in an active group.
  'tab.unfocusedActiveModifiedBorder': Object.freeze(['yellow-faint']), // Border on the top of modified (dirty) active tabs in an unfocused group.
  'tab.unfocusedInactiveModifiedBorder': Object.freeze(['yellow-faint']), // Border on the top of modified (dirty) inactive tabs in an unfocused group.
  'editorPane.background': Object.freeze(['bg-main']), // Background color of the editor pane visible on the left and right side of the centered editor layout.
  'sideBySideEditor.horizontalBorder': Object.freeze(['border']), // Color to separate two editors from each other when shown side by side in an editor group from top to bottom.
  'sideBySideEditor.verticalBorder': Object.freeze(['border']), // Color to separate two editors from each other when shown side by side in an editor group from left to right.

  // Editor colors
  //
  // The most prominent editor colors are the token colors used for syntax
  // highlighting and are based on the language grammar installed. These colors
  // are defined by the Color Theme but can also be customized with the
  // editor.tokenColorCustomizations setting. See Customizing a Color Theme for
  // details on updating a Color Theme and the available token types.
  //
  // All other editor colors are listed here:
  //
  'editor.background': Object.freeze(['bg-main']), // Editor background color.
  'editor.foreground': Object.freeze(['fg-main']), // Editor default foreground color.
  'editorLineNumber.foreground': Object.freeze(['fg-dim']), // Color of editor line numbers.
  'editorLineNumber.activeForeground': Object.freeze(['fg-main']), // Color of the active editor line number.
  'editorLineNumber.dimmedForeground': Object.freeze(['fg-alt']), // Color of the final editor line when editor.renderFinalNewline is set to dimmed.
  'editorCursor.background': Object.freeze(['bg-main']), // The background color of the editor cursor. Allows customizing the color of a character overlapped by a block cursor.
  'editorCursor.foreground': Object.freeze(['fg-main']), // Color of the editor cursor.
  'editorMultiCursor.primary.foreground': Object.freeze(['blue-intense']), // Color of the primary editor cursor when multiple cursors are present.
  'editorMultiCursor.primary.background': Object.freeze(['bg-main']), // The background color of the primary editor cursor when multiple cursors are present. Allows customizing the color of a character overlapped by a block cursor.
  'editorMultiCursor.secondary.foreground': Object.freeze(['magenta']), // Color of secondary editor cursors when multiple cursors are present.
  'editorMultiCursor.secondary.background': Object.freeze(['bg-main']), // The background color of secondary editor cursors when multiple cursors are present. Allows customizing the color of a character overlapped by a block cursor.
  'editor.placeholder.foreground': Object.freeze(['fg-dim']), // Foreground color of the placeholder text in the editor.
  'editor.compositionBorder': Object.freeze(['border']), // The border color for an IME composition.

  // Selection colors are visible when selecting one or more characters. In
  // addition to the selection also all regions with the same content are
  // highlighted.
  //
  'editor.selectionBackground': Object.freeze(['bg-active']), // Color of the editor selection.
  'editor.selectionForeground': Object.freeze(['fg-main']), // Color of the selected text for high contrast.
  'editor.inactiveSelectionBackground': Object.freeze(['bg-inactive']), // Color of the selection in an inactive editor. The color must not be opaque so as not to hide underlying decorations.
  'editor.selectionHighlightBackground': Object.freeze(['bg-inactive']), // Color for regions with the same content as the selection. The color must not be opaque so as not to hide underlying decorations.
  'editor.selectionHighlightBorder': Object.freeze(['border-mode-line-active']), // Border color for regions with the same content as the selection.

  // Word highlight colors are visible when the cursor is inside a symbol or a
  // word. Depending on the language support available for the file type, all
  // matching references and declarations are highlighted and read and write
  // accesses get different colors. If document symbol language support is not
  // available, this falls back to word highlighting.
  //
  'editor.wordHighlightBackground': Object.freeze(['bg-inactive']), // Background color of a symbol during read-access, for example when reading a variable. The color must not be opaque so as not to hide underlying decorations.
  'editor.wordHighlightBorder': Object.freeze(['border-mode-line-active']), // Border color of a symbol during read-access, for example when reading a variable.
  'editor.wordHighlightStrongBackground': Object.freeze(['bg-active']), // Background color of a symbol during write-access, for example when writing to a variable. The color must not be opaque so as not to hide underlying decorations.
  'editor.wordHighlightStrongBorder': Object.freeze(['border']), // Border color of a symbol during write-access, for example when writing to a variable.
  'editor.wordHighlightTextBackground': Object.freeze(['bg-inactive']), // Background color of a textual occurrence for a symbol. The color must not be opaque so as not to hide underlying decorations.
  'editor.wordHighlightTextBorder': Object.freeze(['border-mode-line-active']), // Border color of a textual occurrence for a symbol.

  // Find colors depend on the current find string in the Find/Replace dialog.
  //
  'findMatchBackground': Object.freeze(['bg-search-current']), // Color of the current search match.
  'findMatchForeground': Object.freeze(['fg-main']), // Text color of the current search match.
  'findMatchHighlightForeground': Object.freeze(['fg-main']), // Foreground color of the other search matches.
  'findMatchHighlightBackground': Object.freeze(['bg-search-lazy']), // Color of the other search matches. The color must not be opaque so as not to hide underlying decorations.
  'findRangeHighlightBackground': Object.freeze(['bg-inactive']), // Color the range limiting the search (Enable 'Find in Selection' in the find widget). The color must not be opaque so as not to hide underlying decorations.
  'findMatchBorder': Object.freeze(['blue-intense']), // Border color of the current search match.
  'findMatchHighlightBorder': Object.freeze(['blue']), // Border color of the other search matches.
  'findRangeHighlightBorder': Object.freeze(['border-mode-line-active']), // Border color the range limiting the search (Enable 'Find in Selection' in the find widget).

  // Search colors are used in the search viewlet's global search results.
  //
  'search.resultsInfoForeground': Object.freeze(['fg-dim']), // Color of the text in the search viewlet's completion message. For example, this color is used in the text that says "{x} results in {y} files".

  // Search Editor colors highlight results in a Search Editor. This can be
  // configured separately from other find matches in order to better
  // differentiate between different classes of match in the same editor.
  //
  'searchEditor.findMatchBackground': Object.freeze(['bg-search-current']), // Color of the editor's results.
  'searchEditor.findMatchBorder': Object.freeze(['blue']), // Border color of the editor's results.
  'searchEditor.textInputBorder': Object.freeze(['border']), // Search editor text input box border.

  // The hover highlight is shown behind the symbol for which a hover is shown.
  //
  'hoverHighlightBackground': Object.freeze(['bg-hover']), // Highlight below the word for which a hover is shown. The color must not be opaque so as not to hide underlying decorations.

  // The current line is typically shown as either background highlight or a
  // border (not both).
  //
  'lineHighlightBackground': Object.freeze(['bg-hl-line']), // Background color for the highlight of line at the cursor position.
  'lineHighlightBorder': Object.freeze(['border-mode-line-active']), // Background color for the border around the line at the cursor position.

  // The color for the editor watermark.
  //
  'editorWatermark.foreground': Object.freeze(['fg-dim']), // Foreground color for the labels in the editor watermark.

  // The color for unicode highlights.
  //
  'editorUnicodeHighlight.border': Object.freeze(['yellow']), // Border color used to highlight unicode characters.
  'editorUnicodeHighlight.background': Object.freeze(['bg-yellow-subtle']), // Background color used to highlight unicode characters.

  // The link color is visible when clicking on a link.
  'editorLink.activeForeground': Object.freeze(['blue-intense']), // Color of active links.

  // The range highlight is visible when selecting a search result.
  //
  'rangeHighlightBackground': Object.freeze(['bg-inactive']), // Background color of highlighted ranges, used by Quick Open, Symbol in File and Find features. The color must not be opaque so as not to hide underlying decorations.
  'rangeHighlightBorder': Object.freeze(['border-mode-line-active']), // Background color of the border around highlighted ranges.

  // The symbol highlight is visible when navigating to a symbol via a command
  // such as Go to Definition.
  //
  'symbolHighlightBackground': Object.freeze(['bg-active']), // Background color of highlighted symbol. The color must not be opaque so as not to hide underlying decorations.
  'symbolHighlightBorder': Object.freeze(['border']), // Background color of the border around highlighted symbols.

  // To see the editor white spaces, enable Toggle Render Whitespace.
  //
  'editorWhitespace.foreground': Object.freeze(['fg-dim']), // Color of whitespace characters in the editor.

  // To see the editor indent guides, set "editor.guides.indentation": true and
  // "editor.guides.highlightActiveIndentation": true.
  //
  'editorIndentGuide.background': Object.freeze(['fg-dim']), // Color of the editor indentation guides.
  'editorIndentGuide.background1': Object.freeze(['fg-dim']), // Color of the editor indentation guides (1).
  'editorIndentGuide.background2': Object.freeze(['fg-dim']), // Color of the editor indentation guides (2).
  'editorIndentGuide.background3': Object.freeze(['fg-dim']), // Color of the editor indentation guides (3).
  'editorIndentGuide.background4': Object.freeze(['fg-dim']), // Color of the editor indentation guides (4).
  'editorIndentGuide.background5': Object.freeze(['fg-dim']), // Color of the editor indentation guides (5).
  'editorIndentGuide.background6': Object.freeze(['fg-dim']), // Color of the editor indentation guides (6).
  'editorIndentGuide.activeBackground': Object.freeze(['fg-alt']), // Color of the active editor indentation guide.
  'editorIndentGuide.activeBackground1': Object.freeze(['fg-alt']), // Color of the active editor indentation guides (1).
  'editorIndentGuide.activeBackground2': Object.freeze(['fg-alt']), // Color of the active editor indentation guides (2).
  'editorIndentGuide.activeBackground3': Object.freeze(['fg-alt']), // Color of the active editor indentation guides (3).
  'editorIndentGuide.activeBackground4': Object.freeze(['fg-alt']), // Color of the active editor indentation guides (4).
  'editorIndentGuide.activeBackground5': Object.freeze(['fg-alt']), // Color of the active editor indentation guides (5).
  'editorIndentGuide.activeBackground6': Object.freeze(['fg-alt']), // Color of the active editor indentation guides (6).

  // To see the editor inline hints, set "editor.inlineSuggest.enabled": true.
  //
  'editorInlayHint.background': Object.freeze(['bg-dim']), // Background color of inline hints.
  'editorInlayHint.foreground': Object.freeze(['fg-dim']), // Foreground color of inline hints.
  'editorInlayHint.typeForeground': Object.freeze(['blue']), // Foreground color of inline hints for types
  'editorInlayHint.typeBackground': Object.freeze(['bg-blue-subtle']), // Background color of inline hints for types
  'editorInlayHint.parameterForeground': Object.freeze(['magenta']), // Foreground color of inline hints for parameters
  'editorInlayHint.parameterBackground': Object.freeze(['bg-magenta-subtle']), // Background color of inline hints for parameters

  // To see editor rulers, define their location with "editor.rulers".
  //
  'editorRuler.foreground': Object.freeze(['fg-dim']), // Color of the editor rulers.

  //
  //
  'editor.linkedEditingBackground': Object.freeze(['bg-inactive']), // Background color when the editor is in linked editing mode.

  // CodeLens:
  //
  'editorCodeLens.foreground': Object.freeze(['fg-dim']), // Foreground color of an editor CodeLens.

  // Lightbulb:
  //
  'editorLightBulb.foreground': Object.freeze(['yellow']), // The color of the editor lightbulb icon.
  'editorLightBulbAutoFix.foreground': Object.freeze(['blue']), // The color of the editor lightbulb auto-fix icon.
  'editorLightBulbAi.foreground': Object.freeze(['magenta']), // The color of the editor AI lightbulb icon.

  // Bracket matches:
  //
  'editorBracketMatch.background': Object.freeze(['bg-active']), // Background color behind matching brackets.
  'editorBracketMatch.border': Object.freeze(['border']), // Color for matching brackets boxes.

  // Bracket pair colorization:
  //
  'editorBracketHighlight.foreground1': Object.freeze(['magenta']), // Foreground color of brackets (1). Requires enabling bracket pair colorization.
  'editorBracketHighlight.foreground2': Object.freeze(['blue']), // Foreground color of brackets (2). Requires enabling bracket pair colorization.
  'editorBracketHighlight.foreground3': Object.freeze(['cyan']), // Foreground color of brackets (3). Requires enabling bracket pair colorization.
  'editorBracketHighlight.foreground4': Object.freeze(['green']), // Foreground color of brackets (4). Requires enabling bracket pair colorization.
  'editorBracketHighlight.foreground5': Object.freeze(['yellow']), // Foreground color of brackets (5). Requires enabling bracket pair colorization.
  'editorBracketHighlight.foreground6': Object.freeze(['red']), // Foreground color of brackets (6). Requires enabling bracket pair colorization.
  'editorBracketHighlight.unexpectedBracket.foreground': Object.freeze(['red-intense']), // Foreground color of unexpected brackets.

  // Bracket pair guides:
  //
  'editorBracketPairGuide.activeBackground1': Object.freeze(['magenta-faint']), // Background color of active bracket pair guides (1). Requires enabling bracket pair guides.
  'editorBracketPairGuide.activeBackground2': Object.freeze(['blue-faint']), // Background color of active bracket pair guides (2). Requires enabling bracket pair guides.
  'editorBracketPairGuide.activeBackground3': Object.freeze(['cyan-faint']), // Background color of active bracket pair guides (3). Requires enabling bracket pair guides.
  'editorBracketPairGuide.activeBackground4': Object.freeze(['green-faint']), // Background color of active bracket pair guides (4). Requires enabling bracket pair guides.
  'editorBracketPairGuide.activeBackground5': Object.freeze(['yellow-faint']), // Background color of active bracket pair guides (5). Requires enabling bracket pair guides.
  'editorBracketPairGuide.activeBackground6': Object.freeze(['red-faint']), // Background color of active bracket pair guides (6). Requires enabling bracket pair guides.
  'editorBracketPairGuide.background1': Object.freeze(['magenta-faint']), // Background color of inactive bracket pair guides (1). Requires enabling bracket pair guides.
  'editorBracketPairGuide.background2': Object.freeze(['blue-faint']), // Background color of inactive bracket pair guides (2). Requires enabling bracket pair guides.
  'editorBracketPairGuide.background3': Object.freeze(['cyan-faint']), // Background color of inactive bracket pair guides (3). Requires enabling bracket pair guides.
  'editorBracketPairGuide.background4': Object.freeze(['green-faint']), // Background color of inactive bracket pair guides (4). Requires enabling bracket pair guides.
  'editorBracketPairGuide.background5': Object.freeze(['yellow-faint']), // Background color of inactive bracket pair guides (5). Requires enabling bracket pair guides.
  'editorBracketPairGuide.background6': Object.freeze(['red-faint']), // Background color of inactive bracket pair guides (6). Requires enabling bracket pair guides.

  // Folding:
  //
  'editor.foldBackground': Object.freeze(['bg-inactive']), // Background color for folded ranges. The color must not be opaque so as not to hide underlying decorations.
  'editor.foldPlaceholderForeground': Object.freeze(['fg-dim']), // Color of the collapsed text after the first line of a folded range.

  // Overview ruler:
  //
  'editorOverviewRuler.background': Object.freeze(['bg-active-argument']), // Background color of the editor overview ruler. Only used when the minimap is enabled and placed on the right side of the editor.
  'editorOverviewRuler.border': Object.freeze(['border']), // Color of the overview ruler border.
  'editorOverviewRuler.findMatchForeground': Object.freeze(['blue']), // Overview ruler marker color for find matches. The color must not be opaque so as not to hide underlying decorations.
  'editorOverviewRuler.rangeHighlightForeground': Object.freeze(['blue-faint']), // Overview ruler marker color for highlighted ranges, like by the Quick Open, Symbol in File and Find features. The color must not be opaque so as not to hide underlying decorations.
  'editorOverviewRuler.selectionHighlightForeground': Object.freeze(['cyan-faint']), // Overview ruler marker color for selection highlights. The color must not be opaque so as not to hide underlying decorations.
  'editorOverviewRuler.wordHighlightForeground': Object.freeze(['green-faint']), // Overview ruler marker color for symbol highlights. The color must not be opaque so as not to hide underlying decorations.
  'editorOverviewRuler.wordHighlightStrongForeground': Object.freeze(['green']), // Overview ruler marker color for write-access symbol highlights. The color must not be opaque so as not to hide underlying decorations.
  'editorOverviewRuler.wordHighlightTextForeground': Object.freeze(['green-faint']), // Overview ruler marker color for text document symbol highlights. The color must not be opaque so as not to hide underlying decorations.
  'editorOverviewRuler.modifiedForeground': Object.freeze(['yellow']), // Overview ruler marker color for modified content.
  'editorOverviewRuler.addedForeground': Object.freeze(['green']), // Overview ruler marker color for added content.
  'editorOverviewRuler.deletedForeground': Object.freeze(['red']), // Overview ruler marker color for deleted content.
  'editorOverviewRuler.errorForeground': Object.freeze(['red']), // Overview ruler marker color for errors.
  'editorOverviewRuler.warningForeground': Object.freeze(['yellow']), // Overview ruler marker color for warnings.
  'editorOverviewRuler.infoForeground': Object.freeze(['blue']), // Overview ruler marker color for infos.
  'editorOverviewRuler.bracketMatchForeground': Object.freeze(['border']), // Overview ruler marker color for matching brackets.
  'editorOverviewRuler.inlineChatInserted': Object.freeze(['bg-green-subtle']), // Overview ruler marker color for inline chat inserted content.
  'editorOverviewRuler.inlineChatRemoved': Object.freeze(['bg-red-subtle']), // Overview ruler marker color for inline chat removed content.

  // Errors and warnings:
  //
  'editorError.foreground': Object.freeze(['red']), // Foreground color of error squiggles in the editor.
  'editorError.border': Object.freeze(['red']), // Border color of error boxes in the editor.
  'editorError.background': Object.freeze(['bg-red-subtle']), // Background color of error text in the editor. The color must not be opaque so as not to hide underlying decorations.
  'editorWarning.foreground': Object.freeze(['yellow']), // Foreground color of warning squiggles in the editor.
  'editorWarning.border': Object.freeze(['yellow']), // Border color of warning boxes in the editor.
  'editorWarning.background': Object.freeze(['bg-yellow-subtle']), // Background color of warning text in the editor. The color must not be opaque so as not to hide underlying decorations.
  'editorInfo.foreground': Object.freeze(['blue']), // Foreground color of info squiggles in the editor.
  'editorInfo.border': Object.freeze(['blue']), // Border color of info boxes in the editor.
  'editorInfo.background': Object.freeze(['bg-blue-subtle']), // Background color of info text in the editor. The color must not be opaque so as not to hide underlying decorations.
  'editorHint.foreground': Object.freeze(['cyan']), // Foreground color of hints in the editor.
  'editorHint.border': Object.freeze(['cyan']), // Border color of hint boxes in the editor.
  'problemsErrorIcon.foreground': Object.freeze(['red']), // The color used for the problems error icon.
  'problemsWarningIcon.foreground': Object.freeze(['yellow']), // The color used for the problems warning icon.
  'problemsInfoIcon.foreground': Object.freeze(['blue']), // The color used for the problems info icon.

  // Unused source code:
  //
  'editorUnnecessaryCode.border': Object.freeze(['border']), // Border color of unnecessary (unused) source code in the editor.
  'editorUnnecessaryCode.opacity': Object.freeze(['']), // Opacity of unnecessary (unused) source code in the editor. For example, "#000000c0" will render the code with 75% opacity. For high contrast themes, use the "editorUnnecessaryCode.border" theme color to underline unnecessary code instead of fading it out.

  // The gutter contains the glyph margins and the line numbers:
  //
  'editorGutter.background': Object.freeze(['bg-main']), // Background color of the editor gutter. The gutter contains the glyph margins and the line numbers.
  'editorGutter.modifiedBackground': Object.freeze(['yellow']), // Editor gutter background color for lines that are modified.
  'editorGutter.addedBackground': Object.freeze(['green']), // Editor gutter background color for lines that are added.
  'editorGutter.deletedBackground': Object.freeze(['red']), // Editor gutter background color for lines that are deleted.
  'editorGutter.commentRangeForeground': Object.freeze(['fg-dim']), // Editor gutter decoration color for commenting ranges.
  'editorGutter.commentGlyphForeground': Object.freeze(['fg-dim']), // Editor gutter decoration color for commenting glyphs.
  'editorGutter.commentUnresolvedGlyphForeground': Object.freeze(['yellow']), // Editor gutter decoration color for commenting glyphs for unresolved comment threads.
  'editorGutter.foldingControlForeground': Object.freeze(['fg-dim']), // Color of the folding control in the editor gutter.

  // The editor comments widget can be seen when reviewing pull requests:
  //
  'editorCommentsWidget.resolvedBorder': Object.freeze(['green']), // Color of borders and arrow for resolved comments.
  'editorCommentsWidget.unresolvedBorder': Object.freeze(['yellow']), // Color of borders and arrow for unresolved comments.
  'editorCommentsWidget.rangeBackground': Object.freeze(['bg-inactive']), // Color of background for comment ranges.
  'editorCommentsWidget.rangeActiveBackground': Object.freeze(['bg-hover']), // Color of background for currently selected or hovered comment range.
  'editorCommentsWidget.replyInputBackground': Object.freeze(['bg-main']), // Background color for comment reply input box.

  // Editor inline edits can be seen when using Copilot to suggest the next
  // change to make:
  //
  'inlineEdit.gutterIndicator.primaryForeground': Object.freeze(['blue']), // Foreground color for the primary inline edit gutter indicator.
  'inlineEdit.gutterIndicator.primaryBackground': Object.freeze(['bg-blue-nuanced']), // Background color for the primary inline edit gutter indicator.
  'inlineEdit.gutterIndicator.secondaryForeground': Object.freeze(['blue']), // Foreground color for the secondary inline edit gutter indicator.
  'inlineEdit.gutterIndicator.secondaryBackground': Object.freeze(['bg-blue-nuanced']), // Background color for the secondary inline edit gutter indicator.
  'inlineEdit.gutterIndicator.successfulForeground': Object.freeze(['green']), // Foreground color for the successful inline edit gutter indicator.
  'inlineEdit.gutterIndicator.successfulBackground': Object.freeze(['bg-green-nuanced']), // Background color for the successful inline edit gutter indicator.
  'inlineEdit.gutterIndicator.background': Object.freeze(['bg-dim']), // Background color for the inline edit gutter indicator.
  'inlineEdit.indicator.foreground': Object.freeze(['blue']), // Foreground color for the inline edit indicator.
  'inlineEdit.indicator.background': Object.freeze(['bg-blue-nuanced']), // Background color for the inline edit indicator.
  'inlineEdit.indicator.border': Object.freeze(['border']), // Border color for the inline edit indicator.
  'inlineEdit.originalBackground': Object.freeze(['bg-dim']), // Background color for the original text in inline edits.
  'inlineEdit.modifiedBackground': Object.freeze(['bg-dim']), // Background color for the modified text in inline edits.
  'inlineEdit.originalChangedLineBackground': Object.freeze(['bg-yellow-nuanced']), // Background color for the changed lines in the original text of inline edits.
  'inlineEdit.originalChangedTextBackground': Object.freeze(['bg-yellow-subtle']), // Overlay color for the changed text in the original text of inline edits.
  'inlineEdit.modifiedChangedLineBackground': Object.freeze(['bg-green-nuanced']), // Background color for the changed lines in the modified text of inline edits.
  'inlineEdit.modifiedChangedTextBackground': Object.freeze(['bg-green-subtle']), // Overlay color for the changed text in the modified text of inline edits.
  'inlineEdit.originalBorder': Object.freeze(['border']), // Border color for the original text in inline edits.
  'inlineEdit.modifiedBorder': Object.freeze(['border']), // Border color for the modified text in inline edits.
  'inlineEdit.tabWillAcceptBorder': Object.freeze(['green']), // Border color for the inline edits widget over the original text when tab will accept it.
  'inlineEdit.wordReplacementView.background': Object.freeze(['bg-dim']), // Background color for the inline edit word replacement view.

  // Diff editor colors:
  //
  'diffEditor.insertedTextBackground': Object.freeze(['bg-green-subtle']), // Background color for text that got inserted. The color must not be opaque so as not to hide underlying decorations.
  'diffEditor.insertedTextBorder': Object.freeze(['green']), // Outline color for the text that got inserted.
  'diffEditor.removedTextBackground': Object.freeze(['bg-red-subtle']), // Background color for text that got removed. The color must not be opaque so as not to hide underlying decorations.
  'diffEditor.removedTextBorder': Object.freeze(['red']), // Outline color for text that got removed.
  'diffEditor.border': Object.freeze(['border']), // Border color between the two text editors.
  'diffEditor.diagonalFill': Object.freeze(['bg-active-argument']), // Color of the diff editor's diagonal fill. The diagonal fill is used in side-by-side diff views.
  'diffEditor.insertedLineBackground': Object.freeze(['bg-green-nuanced']), // Background color for lines that got inserted. The color must not be opaque so as not to hide underlying decorations.
  'diffEditor.removedLineBackground': Object.freeze(['bg-red-nuanced']), // Background color for lines that got removed. The color must not be opaque so as not to hide underlying decorations.
  'diffEditorGutter.insertedLineBackground': Object.freeze(['bg-green-nuanced']), // Background color for the margin where lines got inserted.
  'diffEditorGutter.removedLineBackground': Object.freeze(['bg-red-nuanced']), // Background color for the margin where lines got removed.
  'diffEditorOverview.insertedForeground': Object.freeze(['green']), // Diff overview ruler foreground for inserted content.
  'diffEditorOverview.removedForeground': Object.freeze(['red']), // Diff overview ruler foreground for removed content.
  'diffEditor.unchangedRegionBackground': Object.freeze(['bg-dim']), // The color of unchanged blocks in diff editor.
  'diffEditor.unchangedRegionForeground': Object.freeze(['fg-dim']), // The foreground color of unchanged blocks in the diff editor.
  'diffEditor.unchangedRegionShadow': Object.freeze(['bg-dim']), // The color of the shadow around unchanged region widgets.
  'diffEditor.unchangedCodeBackground': Object.freeze(['bg-active-argument']), // The background color of unchanged code in the diff editor.
  'diffEditor.move.border': Object.freeze(['blue']), // The border color for text that got moved in the diff editor.
  'diffEditor.moveActive.border': Object.freeze(['blue-intense']), // The active border color for text that got moved in the diff editor.
  'multiDiffEditor.headerBackground': Object.freeze(['bg-dim']), // The background color of the diff editor's header
  'multiDiffEditor.background': Object.freeze(['bg-main']), // The background color of the multi file diff editor
  'multiDiffEditor.border': Object.freeze(['border']), // The border color of the multi file diff editor

  // Chat colors:
  //
  'chat.requestBorder': Object.freeze(['border']), // The border color of a chat request.
  'chat.requestBackground': Object.freeze(['bg-dim']), // The background color of a chat request.
  'chat.slashCommandBackground': Object.freeze(['bg-inactive']), // The background color of a chat slash command.
  'chat.slashCommandForeground': Object.freeze(['fg-alt']), // The foreground color of a chat slash command.
  'chat.avatarBackground': Object.freeze(['bg-active']), // The background color of a chat avatar.
  'chat.avatarForeground': Object.freeze(['fg-main']), // The foreground color of a chat avatar.
  'chat.editedFileForeground': Object.freeze(['blue']), // The foreground color of a chat edited file in the edited file list.

  // Inline Chat colors:
  //
  'inlineChat.background': Object.freeze(['bg-dim']), // Background color of the interactive editor widget.
  'inlineChat.foreground': Object.freeze(['fg-main']), // Foreground color of the interactive editor widget
  'inlineChat.border': Object.freeze(['border']), // Border color of the interactive editor widget.
  'inlineChat.shadow': Object.freeze(['bg-dim']), // Shadow color of the interactive editor widget.
  'inlineChatInput.border': Object.freeze(['border']), // Border color of the interactive editor input.
  'inlineChatInput.focusBorder': Object.freeze(['border']), // Border color of the interactive editor input when focused.
  'inlineChatInput.placeholderForeground': Object.freeze(['fg-dim']), // Foreground color of the interactive editor input placeholder.
  'inlineChatInput.background': Object.freeze(['bg-main']), // Background color of the interactive editor input.
  'inlineChatDiff.inserted': Object.freeze(['bg-green-subtle']), // Background color of inserted text in the interactive editor input.
  'inlineChatDiff.removed': Object.freeze(['bg-red-subtle']), // Background color of removed text in the interactive editor input.

  // Panel Chat colors:
  //
  'interactive.activeCodeBorder': Object.freeze(['blue-intense']), // The border color for the current interactive code cell when the editor has focus.
  'interactive.inactiveCodeBorder': Object.freeze(['border']), // The border color for the current interactive code cell when the editor does not have focus.

  // Editor widget colors:
  //
  'editorWidget.foreground': Object.freeze(['fg-main']), // Foreground color of editor widgets, such as find/replace.
  'editorWidget.background': Object.freeze(['bg-dim']), // Background color of editor widgets, such as Find/Replace.
  'editorWidget.border': Object.freeze(['border']), // Border color of the editor widget unless the widget does not contain a border or defines its own border color.
  'editorWidget.resizeBorder': Object.freeze(['border']), // Border color of the resize bar of editor widgets. The color is only used if the widget chooses to have a resize border and if the color is not overridden by a widget.
  'editorSuggestWidget.background': Object.freeze(['bg-dim']), // Background color of the suggestion widget.
  'editorSuggestWidget.border': Object.freeze(['border']), // Border color of the suggestion widget.
  'editorSuggestWidget.foreground': Object.freeze(['fg-main']), // Foreground color of the suggestion widget.
  'editorSuggestWidget.focusHighlightForeground': Object.freeze(['blue-intense']), // Color of the match highlights in the suggest widget when an item is focused.
  'editorSuggestWidget.highlightForeground': Object.freeze(['blue']), // Color of the match highlights in the suggestion widget.
  'editorSuggestWidget.selectedBackground': Object.freeze(['bg-active']), // Background color of the selected entry in the suggestion widget.
  'editorSuggestWidget.selectedForeground': Object.freeze(['fg-main']), // Foreground color of the selected entry in the suggest widget.
  'editorSuggestWidget.selectedIconForeground': Object.freeze(['fg-main']), // Icon foreground color of the selected entry in the suggest widget.
  'editorSuggestWidgetStatus.foreground': Object.freeze(['fg-dim']), // Foreground color of the suggest widget status.
  'editorHoverWidget.foreground': Object.freeze(['fg-main']), // Foreground color of the editor hover.
  'editorHoverWidget.background': Object.freeze(['bg-dim']), // Background color of the editor hover.
  'editorHoverWidget.border': Object.freeze(['border']), // Border color of the editor hover.
  'editorHoverWidget.highlightForeground': Object.freeze(['blue']), // Foreground color of the active item in the parameter hint.
  'editorHoverWidget.statusBarBackground': Object.freeze(['bg-active-argument']), // Background color of the editor hover status bar.
  'editorGhostText.border': Object.freeze(['border-mode-line-active']), // Border color of the ghost text shown by inline completion providers and the suggest preview.
  'editorGhostText.background': Object.freeze(['bg-dim']), // Background color of the ghost text in the editor.
  'editorGhostText.foreground': Object.freeze(['fg-dim']), // Foreground color of the ghost text shown by inline completion providers and the suggest preview.
  'editorStickyScroll.background': Object.freeze(['bg-dim']), // Editor sticky scroll background color.
  'editorStickyScroll.border': Object.freeze(['border']), // Border color of sticky scroll in the editor.
  'editorStickyScroll.shadow': Object.freeze(['bg-dim']), // Shadow color of sticky scroll in the editor.
  'editorStickyScrollHover.background': Object.freeze(['bg-hover']), // Editor sticky scroll on hover background color.

  // The Debug Exception widget is a peek view that shows in the editor when
  // debug stops at an exception.
  //
  'debugExceptionWidget.background': Object.freeze(['bg-dim']), // Exception widget background color.
  'debugExceptionWidget.border': Object.freeze(['border']), // Exception widget border color.

  // The editor marker view shows when navigating to errors and warnings in the
  // editor (Go to Next Error or Warning command).
  //
  'editorMarkerNavigation.background': Object.freeze(['bg-dim']), // Editor marker navigation widget background.
  'editorMarkerNavigationError.background': Object.freeze(['bg-red-subtle']), // Editor marker navigation widget error color.
  'editorMarkerNavigationWarning.background': Object.freeze(['bg-yellow-subtle']), // Editor marker navigation widget warning color.
  'editorMarkerNavigationInfo.background': Object.freeze(['bg-blue-nuanced']), // Editor marker navigation widget info color.
  'editorMarkerNavigationError.headerBackground': Object.freeze(['red-faint']), // Editor marker navigation widget error heading background.
  'editorMarkerNavigationWarning.headerBackground': Object.freeze(['yellow-faint']), // Editor marker navigation widget warning heading background.
  'editorMarkerNavigationInfo.headerBackground': Object.freeze(['blue-faint']), // Editor marker navigation widget info heading background.

  // Peek view colors:
  //
  'peekView.border': Object.freeze(['border']), // Color of the peek view borders and arrow.
  'peekViewEditor.background': Object.freeze(['bg-active-argument']), // Background color of the peek view editor.
  'peekViewEditorGutter.background': Object.freeze(['bg-dim']), // Background color of the gutter in the peek view editor.
  'peekViewEditor.matchHighlightBackground': Object.freeze(['bg-search-current']), // Match highlight color in the peek view editor.
  'peekViewEditor.matchHighlightBorder': Object.freeze(['blue']), // Match highlight border color in the peek view editor.
  'peekViewResult.background': Object.freeze(['bg-dim']), // Background color of the peek view result list.
  'peekViewResult.fileForeground': Object.freeze(['fg-main']), // Foreground color for file nodes in the peek view result list.
  'peekViewResult.lineForeground': Object.freeze(['fg-dim']), // Foreground color for line nodes in the peek view result list.
  'peekViewResult.matchHighlightBackground': Object.freeze(['bg-search-lazy']), // Match highlight color in the peek view result list.
  'peekViewResult.selectionBackground': Object.freeze(['bg-active']), // Background color of the selected entry in the peek view result list.
  'peekViewResult.selectionForeground': Object.freeze(['fg-main']), // Foreground color of the selected entry in the peek view result list.
  'peekViewTitle.background': Object.freeze(['bg-active']), // Background color of the peek view title area.
  'peekViewTitleDescription.foreground': Object.freeze(['fg-dim']), // Color of the peek view title info.
  'peekViewTitleLabel.foreground': Object.freeze(['fg-main']), // Color of the peek view title.
  'peekViewEditorStickyScroll.background': Object.freeze(['bg-dim']), // Background color of sticky scroll in the peek view editor.

  // Merge conflicts colors:
  //
  'merge.currentHeaderBackground': Object.freeze(['bg-blue-nuanced']), // Current header background in inline merge conflicts. The color must not be opaque so as not to hide underlying decorations.
  'merge.currentContentBackground': Object.freeze(['bg-blue-nuanced']), // Current content background in inline merge conflicts. The color must not be opaque so as not to hide underlying decorations.
  'merge.incomingHeaderBackground': Object.freeze(['bg-green-subtle']), // Incoming header background in inline merge conflicts. The color must not be opaque so as not to hide underlying decorations.
  'merge.incomingContentBackground': Object.freeze(['bg-green-nuanced']), // Incoming content background in inline merge conflicts. The color must not be opaque so as not to hide underlying decorations.
  'merge.border': Object.freeze(['border']), // Border color on headers and the splitter in inline merge conflicts.
  'merge.commonContentBackground': Object.freeze(['bg-inactive']), // Common ancestor content background in inline merge-conflicts. The color must not be opaque so as not to hide underlying decorations.
  'merge.commonHeaderBackground': Object.freeze(['bg-active-argument']), // Common ancestor header background in inline merge-conflicts. The color must not be opaque so as not to hide underlying decorations.
  'editorOverviewRuler.currentContentForeground': Object.freeze(['blue']), // Current overview ruler foreground for inline merge conflicts.
  'editorOverviewRuler.incomingContentForeground': Object.freeze(['green']), // Incoming overview ruler foreground for inline merge conflicts.
  'editorOverviewRuler.commonContentForeground': Object.freeze(['fg-dim']), // Common ancestor overview ruler foreground for inline merge conflicts.
  'editorOverviewRuler.commentForeground': Object.freeze(['green']), // Editor overview ruler decoration color for resolved comments. This color should be opaque.
  'editorOverviewRuler.commentUnresolvedForeground': Object.freeze(['yellow']), // Editor overview ruler decoration color for unresolved comments. This color should be opaque.
  'mergeEditor.change.background': Object.freeze(['bg-inactive']), // The background color for changes.
  'mergeEditor.change.word.background': Object.freeze(['bg-active']), // The background color for word changes.
  'mergeEditor.conflict.unhandledUnfocused.border': Object.freeze(['red']), // The border color of unhandled unfocused conflicts.
  'mergeEditor.conflict.unhandledFocused.border': Object.freeze(['red-intense']), // The border color of unhandled focused conflicts.
  'mergeEditor.conflict.handledUnfocused.border': Object.freeze(['green']), // The border color of handled unfocused conflicts.
  'mergeEditor.conflict.handledFocused.border': Object.freeze(['green-intense']), // The border color of handled focused conflicts.
  'mergeEditor.conflict.handled.minimapOverViewRuler': Object.freeze(['green']), // The foreground color for changes in input 1.
  'mergeEditor.conflict.unhandled.minimapOverViewRuler': Object.freeze(['red']), // The foreground color for changes in input 1.
  'mergeEditor.conflictingLines.background': Object.freeze(['bg-red-nuanced']), // The background of the "Conflicting Lines" text.
  'mergeEditor.changeBase.background': Object.freeze(['bg-inactive']), // The background color for changes in base.
  'mergeEditor.changeBase.word.background': Object.freeze(['bg-active']), // The background color for word changes in base.
  'mergeEditor.conflict.input1.background': Object.freeze(['bg-blue-nuanced']), // The background color of decorations in input 1.
  'mergeEditor.conflict.input2.background': Object.freeze(['bg-green-nuanced']), // The background color of decorations in input 2.

  // Panel colors:
  //
  'panel.background': Object.freeze(['bg-dim']), // Panel background color.
  'panel.border': Object.freeze(['border']), // Panel border color to separate the panel from the editor.
  'panel.dropBorder': Object.freeze(['blue']), // Drag and drop feedback color for the panel titles. Panels are shown below the editor area and contain views like output and integrated terminal.
  'panelTitle.activeBorder': Object.freeze(['blue-intense']), // Border color for the active panel title.
  'panelTitle.activeForeground': Object.freeze(['fg-main']), // Title color for the active panel.
  'panelTitle.inactiveForeground': Object.freeze(['fg-dim']), // Title color for the inactive panel.
  'panelTitle.border': Object.freeze(['border']), // Panel title border color on the bottom, separating the title from the views. Panels are shown below the editor area and contain views like output and integrated terminal.
  'panelTitleBadge.background': Object.freeze(['bg-blue-nuanced']), // Panel title badge background color. Panels are shown below the editor area and contain views like output and integrated terminal.
  'panelTitleBadge.foreground': Object.freeze(['fg-main']), // Panel title badge foreground color. Panels are shown below the editor area and contain views like output and integrated terminal.
  'panelInput.border': Object.freeze(['border']), // Input box border for inputs in the panel.
  'panelSection.border': Object.freeze(['border']), // Panel section border color used when multiple views are stacked horizontally in the panel. Panels are shown below the editor area and contain views like output and integrated terminal.
  'panelSection.dropBackground': Object.freeze(['bg-inactive']), // Drag and drop feedback color for the panel sections. The color should have transparency so that the panel sections can still shine through. Panels are shown below the editor area and contain views like output and integrated terminal.
  'panelSectionHeader.background': Object.freeze(['bg-active-argument']), // Panel section header background color. Panels are shown below the editor area and contain views like output and integrated terminal.
  'panelSectionHeader.foreground': Object.freeze(['fg-main']), // Panel section header foreground color. Panels are shown below the editor area and contain views like output and integrated terminal.
  'panelStickyScroll.background': Object.freeze(['bg-dim']), // Background color of sticky scroll in the panel.
  'panelStickyScroll.border': Object.freeze(['border']), // Border color of sticky scroll in the panel.
  'panelStickyScroll.shadow': Object.freeze(['bg-dim']), // Shadow color of sticky scroll in the panel.
  'panelSectionHeader.border': Object.freeze(['border']), // Panel section header border color used when multiple views are stacked vertically in the panel. Panels are shown below the editor area and contain views like output and integrated terminal.
  'outputView.background': Object.freeze(['bg-main']), // Output view background color.
  'outputViewStickyScroll.background': Object.freeze(['bg-dim']), // Output view sticky scroll background color.

  // Status Bar colors:
  //
  'statusBar.background': Object.freeze(['bg-mode-line-active']), // Standard Status Bar background color.
  'statusBar.foreground': Object.freeze(['fg-main']), // Status Bar foreground color.
  'statusBar.border': Object.freeze(['border']), // Status Bar border color separating the Status Bar and editor.
  'statusBar.debuggingBackground': Object.freeze(['bg-magenta-subtle']), // Status Bar background color when a program is being debugged.
  'statusBar.debuggingForeground': Object.freeze(['fg-main']), // Status Bar foreground color when a program is being debugged.
  'statusBar.debuggingBorder': Object.freeze(['magenta']), // Status Bar border color separating the Status Bar and editor when a program is being debugged.
  'statusBar.noFolderForeground': Object.freeze(['fg-dim']), // Status Bar foreground color when no folder is opened.
  'statusBar.noFolderBackground': Object.freeze(['bg-inactive']), // Status Bar background color when no folder is opened.
  'statusBar.noFolderBorder': Object.freeze(['border']), // Status Bar border color separating the Status Bar and editor when no folder is opened.
  'statusBarItem.activeBackground': Object.freeze(['bg-active']), // Status Bar item background color when clicking.
  'statusBarItem.hoverForeground': Object.freeze(['fg-main']), // Status bar item foreground color when hovering. The status bar is shown in the bottom of the window.
  'statusBarItem.hoverBackground': Object.freeze(['bg-hover']), // Status Bar item background color when hovering.
  'statusBarItem.prominentForeground': Object.freeze(['fg-main']), // Status Bar prominent items foreground color.
  'statusBarItem.prominentBackground': Object.freeze(['bg-blue-nuanced']), // Status Bar prominent items background color.
  'statusBarItem.prominentHoverForeground': Object.freeze(['fg-main']), // Status bar prominent items foreground color when hovering. Prominent items stand out from other status bar entries to indicate importance.
  'statusBarItem.prominentHoverBackground': Object.freeze(['bg-blue-nuanced']), // Status Bar prominent items background color when hovering.
  'statusBarItem.remoteBackground': Object.freeze(['magenta']), // Background color for the remote indicator on the status bar.
  'statusBarItem.remoteForeground': Object.freeze(['bg-main']), // Foreground color for the remote indicator on the status bar.
  'statusBarItem.remoteHoverBackground': Object.freeze(['green']), // Background color for the remote indicator on the status bar when hovering.
  'statusBarItem.remoteHoverForeground': Object.freeze(['bg-main']), // Foreground color for the remote indicator on the status bar when hovering.
  'statusBarItem.errorBackground': Object.freeze(['red']), // Status bar error items background color. Error items stand out from other status bar entries to indicate error conditions.
  'statusBarItem.errorForeground': Object.freeze(['bg-main']), // Status bar error items foreground color. Error items stand out from other status bar entries to indicate error conditions.
  'statusBarItem.errorHoverBackground': Object.freeze(['red-intense']), // Status bar error items background color when hovering. Error items stand out from other status bar entries to indicate error conditions.
  'statusBarItem.errorHoverForeground': Object.freeze(['bg-main']), // Status bar error items foreground color when hovering. Error items stand out from other status bar entries to indicate error conditions.
  'statusBarItem.warningBackground': Object.freeze(['yellow']), // Status bar warning items background color. Warning items stand out from other status bar entries to indicate warning conditions.
  'statusBarItem.warningForeground': Object.freeze(['fg-main']), // Status bar warning items foreground color. Warning items stand out from other status bar entries to indicate warning conditions.
  'statusBarItem.warningHoverBackground': Object.freeze(['yellow-intense']), // Status bar warning items background color when hovering. Warning items stand out from other status bar entries to indicate warning conditions.
  'statusBarItem.warningHoverForeground': Object.freeze(['fg-main']), // Status bar warning items foreground color when hovering. Warning items stand out from other status bar entries to indicate warning conditions.
  'statusBarItem.compactHoverBackground': Object.freeze(['bg-hover']), // Status bar item background color when hovering an item that contains two hovers. The status bar is shown in the bottom of the window.
  'statusBarItem.focusBorder': Object.freeze(['border']), // Status bar item border color when focused on keyboard navigation. The status bar is shown in the bottom of the window.
  'statusBar.focusBorder': Object.freeze(['border']), // Status bar border color when focused on keyboard navigation. The status bar is shown in the bottom of the window.
  'statusBarItem.offlineBackground': Object.freeze(['bg-red-subtle']), // Status bar item background color when the workbench is offline.
  'statusBarItem.offlineForeground': Object.freeze(['fg-main']), // Status bar item foreground color when the workbench is offline.
  'statusBarItem.offlineHoverForeground': Object.freeze(['fg-main']), // Status bar item foreground hover color when the workbench is offline.
  'statusBarItem.offlineHoverBackground': Object.freeze(['red']), // Status bar item background hover color when the workbench is offline.

  // Prominent items stand out from other Status Bar entries to indicate
  // importance. One example is the Toggle Tab Key Moves Focus command change
  // mode indicator.
  //
  'titleBar.activeBackground': Object.freeze(['bg-dim']), // Title Bar background when the window is active.
  'titleBar.activeForeground': Object.freeze(['fg-main']), // Title Bar foreground when the window is active.
  'titleBar.inactiveBackground': Object.freeze(['bg-inactive']), // Title Bar background when the window is inactive.
  'titleBar.inactiveForeground': Object.freeze(['fg-dim']), // Title Bar foreground when the window is inactive.
  'titleBar.border': Object.freeze(['border']), // Title bar border color.

  // Menu Bar colors:
  //
  'menubar.selectionForeground': Object.freeze(['fg-main']), // Foreground color of the selected menu item in the menubar.
  'menubar.selectionBackground': Object.freeze(['bg-active']), // Background color of the selected menu item in the menubar.
  'menubar.selectionBorder': Object.freeze(['border']), // Border color of the selected menu item in the menubar.
  'menu.foreground': Object.freeze(['fg-main']), // Foreground color of menu items.
  'menu.background': Object.freeze(['bg-dim']), // Background color of menu items.
  'menu.selectionForeground': Object.freeze(['fg-main']), // Foreground color of the selected menu item in menus.
  'menu.selectionBackground': Object.freeze(['bg-active']), // Background color of the selected menu item in menus.
  'menu.selectionBorder': Object.freeze(['border']), // Border color of the selected menu item in menus.
  'menu.separatorBackground': Object.freeze(['border']), // Color of a separator menu item in menus.
  'menu.border': Object.freeze(['border']), // Border color of menus.

  // Command Center colors:
  //
  'commandCenter.foreground': Object.freeze(['fg-main']), // Foreground color of the Command Center.
  'commandCenter.activeForeground': Object.freeze(['fg-main']), // Active foreground color of the Command Center.
  'commandCenter.background': Object.freeze(['bg-dim']), // Background color of the Command Center.
  'commandCenter.activeBackground': Object.freeze(['bg-active']), // Active background color of the Command Center.
  'commandCenter.border': Object.freeze(['border']), // Border color of the Command Center.
  'commandCenter.inactiveForeground': Object.freeze(['fg-dim']), // Foreground color of the Command Center when the window is inactive.
  'commandCenter.inactiveBorder': Object.freeze(['border-mode-line-active']), // Border color of the Command Center when the window is inactive.
  'commandCenter.activeBorder': Object.freeze(['border']), // Active border color of the Command Center.
  'commandCenter.debuggingBackground': Object.freeze(['bg-magenta-subtle']), // Command Center background color when a program is being debugged.

  // Notification colors:
  //
  'notificationCenter.border': Object.freeze(['border']), // Notification Center border color.
  'notificationCenterHeader.foreground': Object.freeze(['fg-main']), // Notification Center header foreground color.
  'notificationCenterHeader.background': Object.freeze(['bg-active-argument']), // Notification Center header background color.
  'notificationToast.border': Object.freeze(['border']), // Notification toast border color.
  'notifications.foreground': Object.freeze(['fg-main']), // Notification foreground color.
  'notifications.background': Object.freeze(['bg-dim']), // Notification background color.
  'notifications.border': Object.freeze(['border']), // Notification border color separating from other notifications in the Notification Center.
  'notificationLink.foreground': Object.freeze(['blue']), // Notification links foreground color.
  'notificationsErrorIcon.foreground': Object.freeze(['red']), // The color used for the notification error icon.
  'notificationsWarningIcon.foreground': Object.freeze(['yellow']), // The color used for the notification warning icon.
  'notificationsInfoIcon.foreground': Object.freeze(['blue']), // The color used for the notification info icon.

  // Banner colors:
  //
  'banner.background': Object.freeze(['bg-active-argument']), // Banner background color.
  'banner.foreground': Object.freeze(['fg-main']), // Banner foreground color.
  'banner.iconForeground': Object.freeze(['blue']), // Color for the icon in front of the banner text.

  // Extensions colors:
  //
  'extensionButton.prominentForeground': Object.freeze(['fg-main']), // Extension view button foreground color (for example Install button).
  'extensionButton.prominentBackground': Object.freeze(['blue']), // Extension view button background color.
  'extensionButton.prominentHoverBackground': Object.freeze(['blue-intense']), // Extension view button background hover color.
  'extensionButton.background': Object.freeze(['bg-dim']), // Button background color for extension actions.
  'extensionButton.foreground': Object.freeze(['fg-main']), // Button foreground color for extension actions.
  'extensionButton.hoverBackground': Object.freeze(['bg-hover']), // Button background hover color for extension actions.
  'extensionButton.separator': Object.freeze(['border']), // Button separator color for extension actions.
  'extensionBadge.remoteBackground': Object.freeze(['green']), // Background color for the remote badge in the extensions view.
  'extensionBadge.remoteForeground': Object.freeze(['bg-main']), // Foreground color for the remote badge in the extensions view.
  'extensionIcon.starForeground': Object.freeze(['yellow']), // The icon color for extension ratings.
  'extensionIcon.verifiedForeground': Object.freeze(['blue']), // The icon color for extension verified publisher.
  'extensionIcon.preReleaseForeground': Object.freeze(['magenta']), // The icon color for pre-release extension.
  'extensionIcon.sponsorForeground': Object.freeze(['red']), // The icon color for extension sponsor.

  // Quick picker colors:
  //
  'pickerGroup.border': Object.freeze(['border']), // Quick picker (Quick Open) color for grouping borders.
  'pickerGroup.foreground': Object.freeze(['fg-alt']), // Quick picker (Quick Open) color for grouping labels.
  'quickInput.background': Object.freeze(['bg-dim']), // Quick input background color. The quick input widget is the container for views like the color theme picker.
  'quickInput.foreground': Object.freeze(['fg-main']), // Quick input foreground color. The quick input widget is the container for views like the color theme picker.
  'quickInputList.focusBackground': Object.freeze(['bg-active']), // Quick picker background color for the focused item.
  'quickInputList.focusForeground': Object.freeze(['fg-main']), // Quick picker foreground color for the focused item.
  'quickInputList.focusIconForeground': Object.freeze(['fg-main']), // Quick picker icon foreground color for the focused item.
  'quickInputTitle.background': Object.freeze(['bg-active-argument']), // Quick picker title background color. The quick picker widget is the container for pickers like the Command Palette.

  // Keybinding label colors:
  //
  'keybindingLabel.background': Object.freeze(['bg-active-argument']), // Keybinding label background color. The keybinding label is used to represent a keyboard shortcut.
  'keybindingLabel.foreground': Object.freeze(['fg-main']), // Keybinding label foreground color. The keybinding label is used to represent a keyboard shortcut.
  'keybindingLabel.border': Object.freeze(['border']), // Keybinding label border color. The keybinding label is used to represent a keyboard shortcut.
  'keybindingLabel.bottomBorder': Object.freeze(['border-mode-line-active']), // Keybinding label border bottom color. The keybinding label is used to represent a keyboard shortcut.

  // Keyboard shortcut table colors:
  //
  'keybindingTable.headerBackground': Object.freeze(['bg-active-argument']), // Background color for the keyboard shortcuts table header.
  'keybindingTable.rowsBackground': Object.freeze(['bg-dim']), // Background color for the keyboard shortcuts table rows.

  // Integrated Terminal colors:
  //
  'terminal.background': Object.freeze(['bg-dim']), // The background of the Integrated Terminal's viewport.
  'terminal.border': Object.freeze(['border']), // The color of the border that separates split panes within the terminal. This defaults to panel.border.
  'terminal.foreground': Object.freeze(['fg-main']), // The default foreground color of the Integrated Terminal.
  'terminal.ansiBlack': Object.freeze(['bg-active-argument']), // 'Black' ANSI color in the terminal.
  'terminal.ansiBlue': Object.freeze(['blue']), // 'Blue' ANSI color in the terminal.
  'terminal.ansiBrightBlack': Object.freeze(['fg-dim']), // 'BrightBlack' ANSI color in the terminal.
  'terminal.ansiBrightBlue': Object.freeze(['blue-intense']), // 'BrightBlue' ANSI color in the terminal.
  'terminal.ansiBrightCyan': Object.freeze(['cyan-intense']), // 'BrightCyan' ANSI color in the terminal.
  'terminal.ansiBrightGreen': Object.freeze(['green-intense']), // 'BrightGreen' ANSI color in the terminal.
  'terminal.ansiBrightMagenta': Object.freeze(['magenta-intense']), // 'BrightMagenta' ANSI color in the terminal.
  'terminal.ansiBrightRed': Object.freeze(['red-intense']), // 'BrightRed' ANSI color in the terminal.
  'terminal.ansiBrightWhite': Object.freeze(['fg-main']), // 'BrightWhite' ANSI color in the terminal.
  'terminal.ansiBrightYellow': Object.freeze(['yellow-intense']), // 'BrightYellow' ANSI color in the terminal.
  'terminal.ansiCyan': Object.freeze(['cyan']), // 'Cyan' ANSI color in the terminal.
  'terminal.ansiGreen': Object.freeze(['green']), // 'Green' ANSI color in the terminal.
  'terminal.ansiMagenta': Object.freeze(['magenta']), // 'Magenta' ANSI color in the terminal.
  'terminal.ansiRed': Object.freeze(['red']), // 'Red' ANSI color in the terminal.
  'terminal.ansiWhite': Object.freeze(['fg-dim']), // 'White' ANSI color in the terminal.
  'terminal.ansiYellow': Object.freeze(['yellow']), // 'Yellow' ANSI color in the terminal.
  'terminal.selectionBackground': Object.freeze(['bg-active']), // The selection background color of the terminal.
  'terminal.selectionForeground': Object.freeze(['fg-main']), // The selection foreground color of the terminal. When this is null the selection foreground will be retained and have the minimum contrast ratio feature applied.
  'terminal.inactiveSelectionBackground': Object.freeze(['bg-inactive']), // The selection background color of the terminal when it does not have focus.
  'terminal.findMatchBackground': Object.freeze(['bg-search-current']), // Color of the current search match in the terminal. The color must not be opaque so as not to hide underlying terminal content.
  'terminal.findMatchBorder': Object.freeze(['blue']), // Border color of the current search match in the terminal.
  'terminal.findMatchHighlightBackground': Object.freeze(['bg-search-lazy']), // Color of the other search matches in the terminal. The color must not be opaque so as not to hide underlying terminal content.
  'terminal.findMatchHighlightBorder': Object.freeze(['yellow']), // Border color of the other search matches in the terminal.
  'terminal.hoverHighlightBackground': Object.freeze(['bg-hover']), // Color of the highlight when hovering a link in the terminal.
  'terminalCursor.background': Object.freeze(['bg-main']), // The background color of the terminal cursor. Allows customizing the color of a character overlapped by a block cursor.
  'terminalCursor.foreground': Object.freeze(['fg-main']), // The foreground color of the terminal cursor.
  'terminal.dropBackground': Object.freeze(['bg-inactive']), // The background color when dragging on top of terminals. The color should have transparency so that the terminal contents can still shine through.
  'terminal.tab.activeBorder': Object.freeze(['blue-intense']), // Border on the side of the terminal tab in the panel. This defaults to tab.activeBorder.
  'terminalCommandDecoration.defaultBackground': Object.freeze(['bg-dim']), // The default terminal command decoration background color.
  'terminalCommandDecoration.successBackground': Object.freeze(['bg-green-subtle']), // The terminal command decoration background color for successful commands.
  'terminalCommandDecoration.errorBackground': Object.freeze(['bg-red-subtle']), // The terminal command decoration background color for error commands.
  'terminalOverviewRuler.cursorForeground': Object.freeze(['blue']), // The overview ruler cursor color.
  'terminalOverviewRuler.findMatchForeground': Object.freeze(['yellow']), // Overview ruler marker color for find matches in the terminal.
  'terminalStickyScroll.background': Object.freeze(['bg-dim']), // The background color of the sticky scroll overlay in the terminal.
  'terminalStickyScroll.border': Object.freeze(['border']), // The border of the sticky scroll overlay in the terminal.
  'terminalStickyScrollHover.background': Object.freeze(['bg-hover']), // The background color of the sticky scroll overlay in the terminal when hovered.
  'terminal.initialHintForeground': Object.freeze(['fg-dim']), // Foreground color of the terminal initial hint.
  'terminalOverviewRuler.border': Object.freeze(['border']), // The overview ruler left-side border color.
  'terminalCommandGuide.foreground': Object.freeze(['blue']), // The foreground color of the terminal command guide that appears to the left of a command and its output on hover.
  'terminalSymbolIcon.aliasForeground': Object.freeze(['blue']), // The foreground color for an alias icon. These icons will appear in the terminal suggest widget
  'terminalSymbolIcon.flagForeground': Object.freeze(['yellow']), // The foreground color for a flag icon. These icons will appear in the terminal suggest widget

  // Debug colors:
  //
  'debugToolBar.background': Object.freeze(['bg-dim']), // Debug toolbar background color.
  'debugToolBar.border': Object.freeze(['border']), // Debug toolbar border color.
  'editor.stackFrameHighlightBackground': Object.freeze(['bg-yellow-subtle']), // Background color of the top stack frame highlight in the editor.
  'editor.focusedStackFrameHighlightBackground': Object.freeze(['bg-yellow-nuanced']), // Background color of the focused stack frame highlight in the editor.
  'editor.inlineValuesForeground': Object.freeze(['fg-dim']), // Color for the debug inline value text.
  'editor.inlineValuesBackground': Object.freeze(['bg-inactive']), // Color for the debug inline value background.
  'debugView.exceptionLabelForeground': Object.freeze(['fg-main']), // Foreground color for a label shown in the CALL STACK view when the debugger breaks on an exception.
  'debugView.exceptionLabelBackground': Object.freeze(['bg-red-subtle']), // Background color for a label shown in the CALL STACK view when the debugger breaks on an exception.
  'debugView.stateLabelForeground': Object.freeze(['fg-main']), // Foreground color for a label in the CALL STACK view showing the current session's or thread's state.
  'debugView.stateLabelBackground': Object.freeze(['bg-blue-subtle']), // Background color for a label in the CALL STACK view showing the current session's or thread's state.
  'debugView.valueChangedHighlight': Object.freeze(['blue-intense']), // Color used to highlight value changes in the debug views (such as in the Variables view).
  'debugTokenExpression.name': Object.freeze(['cyan']), // Foreground color for the token names shown in debug views (such as in the Variables or Watch view).
  'debugTokenExpression.value': Object.freeze(['fg-main']), // Foreground color for the token values shown in debug views.
  'debugTokenExpression.string': Object.freeze(['green']), // Foreground color for strings in debug views.
  'debugTokenExpression.boolean': Object.freeze(['blue']), // Foreground color for booleans in debug views.
  'debugTokenExpression.number': Object.freeze(['magenta']), // Foreground color for numbers in debug views.
  'debugTokenExpression.error': Object.freeze(['red']), // Foreground color for expression errors in debug views.
  'debugTokenExpression.type': Object.freeze(['yellow']), // Foreground color for the token types shown in the debug views (ie. the Variables or Watch view).

  // Testing colors:
  //
  'testing.runAction': Object.freeze(['green']), // Color for 'run' icons in the editor.
  'testing.iconErrored': Object.freeze(['red']), // Color for the 'Errored' icon in the test explorer.
  'testing.iconFailed': Object.freeze(['red']), // Color for the 'failed' icon in the test explorer.
  'testing.iconPassed': Object.freeze(['green']), // Color for the 'passed' icon in the test explorer.
  'testing.iconQueued': Object.freeze(['blue']), // Color for the 'Queued' icon in the test explorer.
  'testing.iconUnset': Object.freeze(['fg-dim']), // Color for the 'Unset' icon in the test explorer.
  'testing.iconSkipped': Object.freeze(['yellow']), // Color for the 'Skipped' icon in the test explorer.
  'testing.iconErrored.retired': Object.freeze(['red-faint']), // Retired color for the 'Errored' icon in the test explorer.
  'testing.iconFailed.retired': Object.freeze(['red-faint']), // Retired color for the 'failed' icon in the test explorer.
  'testing.iconPassed.retired': Object.freeze(['green-faint']), // Retired color for the 'passed' icon in the test explorer.
  'testing.iconQueued.retired': Object.freeze(['blue-faint']), // Retired color for the 'Queued' icon in the test explorer.
  'testing.iconUnset.retired': Object.freeze(['fg-alt']), // Retired color for the 'Unset' icon in the test explorer.
  'testing.iconSkipped.retired': Object.freeze(['yellow-faint']), // Retired color for the 'Skipped' icon in the test explorer.
  'testing.peekBorder': Object.freeze(['border']), // Color of the peek view borders and arrow.
  'testing.peekHeaderBackground': Object.freeze(['bg-active-argument']), // Color of the peek view borders and arrow.
  'testing.message.error.lineBackground': Object.freeze(['bg-red-nuanced']), // Margin color beside error messages shown inline in the editor.
  'testing.message.info.decorationForeground': Object.freeze(['blue']), // Text color of test info messages shown inline in the editor.
  'testing.message.info.lineBackground': Object.freeze(['bg-blue-nuanced']), // Margin color beside info messages shown inline in the editor.
  'testing.messagePeekBorder': Object.freeze(['border']), // Color of the peek view borders and arrow when peeking a logged message.
  'testing.messagePeekHeaderBackground': Object.freeze(['bg-active-argument']), // Color of the peek view borders and arrow when peeking a logged message.
  'testing.coveredBackground': Object.freeze(['bg-green-nuanced']), // Background color of text that was covered.
  'testing.coveredBorder': Object.freeze(['green']), // Border color of text that was covered.
  'testing.coveredGutterBackground': Object.freeze(['bg-green-nuanced']), // Gutter color of regions where code was covered.
  'testing.uncoveredBranchBackground': Object.freeze(['bg-yellow-subtle']), // Background of the widget shown for an uncovered branch.
  'testing.uncoveredBackground': Object.freeze(['bg-red-nuanced']), // Background color of text that was not covered.
  'testing.uncoveredBorder': Object.freeze(['red']), // Border color of text that was not covered.
  'testing.uncoveredGutterBackground': Object.freeze(['bg-red-nuanced']), // Gutter color of regions where code not covered.
  'testing.coverCountBadgeBackground': Object.freeze(['bg-active-argument']), // Background for the badge indicating execution count
  'testing.coverCountBadgeForeground': Object.freeze(['fg-main']), // Foreground for the badge indicating execution count
  'testing.message.error.badgeBackground': Object.freeze(['bg-red-subtle']), // Background color of test error messages shown inline in the editor.
  'testing.message.error.badgeBorder': Object.freeze(['red']), // Border color of test error messages shown inline in the editor.
  'testing.message.error.badgeForeground': Object.freeze(['fg-main']), // Text color of test error messages shown inline in the editor.

  // Welcome page colors:
  //
  'welcomePage.background': Object.freeze(['bg-main']), // Background color for the Welcome page.
  'welcomePage.progress.background': Object.freeze(['bg-dim']), // Foreground color for the Welcome page progress bars.
  'welcomePage.progress.foreground': Object.freeze(['blue']), // Background color for the Welcome page progress bars.
  'welcomePage.tileBackground': Object.freeze(['bg-dim']), // Background color for the tiles on the Welcome page.
  'welcomePage.tileHoverBackground': Object.freeze(['bg-hover']), // Hover background color for the tiles on the Welcome page.
  'welcomePage.tileBorder': Object.freeze(['border']), // Border color for the tiles on the Welcome page.
  'walkThrough.embeddedEditorBackground': Object.freeze(['bg-dim']), // Background color for the embedded editors on the Interactive Playground.
  'walkthrough.stepTitle.foreground': Object.freeze(['fg-main']), // Foreground color of the heading of each walkthrough step.

  // Git colors:
  //
  'gitDecoration.addedResourceForeground': Object.freeze(['green']), // Color for added Git resources. Used for file labels and the SCM viewlet.
  'gitDecoration.modifiedResourceForeground': Object.freeze(['blue']), // Color for modified Git resources. Used for file labels and the SCM viewlet.
  'gitDecoration.deletedResourceForeground': Object.freeze(['red']), // Color for deleted Git resources. Used for file labels and the SCM viewlet.
  'gitDecoration.renamedResourceForeground': Object.freeze(['cyan']), // Color for renamed or copied Git resources. Used for file labels and the SCM viewlet.
  'gitDecoration.stageModifiedResourceForeground': Object.freeze(['blue-intense']), // Color for staged modifications git decorations. Used for file labels and the SCM viewlet.
  'gitDecoration.stageDeletedResourceForeground': Object.freeze(['red-intense']), // Color for staged deletions git decorations. Used for file labels and the SCM viewlet.
  'gitDecoration.untrackedResourceForeground': Object.freeze(['green-warmer']), // Color for untracked Git resources. Used for file labels and the SCM viewlet.
  'gitDecoration.ignoredResourceForeground': Object.freeze(['fg-alt']), // Color for ignored Git resources. Used for file labels and the SCM viewlet.
  'gitDecoration.conflictingResourceForeground': Object.freeze(['yellow']), // Color for conflicting Git resources. Used for file labels and the SCM viewlet.
  'gitDecoration.submoduleResourceForeground': Object.freeze(['magenta']), // Color for submodule resources.
  'git.blame.editorDecorationForeground': Object.freeze(['fg-dim']), // Color for the blame editor decoration.

  // Source Control Graph colors:
  //
  'scmGraph.historyItemHoverLabelForeground': Object.freeze(['fg-main']), // History item hover label foreground color.
  'scmGraph.foreground1': Object.freeze(['blue']), // Source control graph foreground color (1).
  'scmGraph.foreground2': Object.freeze(['green']), // Source control graph foreground color (2).
  'scmGraph.foreground3': Object.freeze(['magenta']), // Source control graph foreground color (3).
  'scmGraph.foreground4': Object.freeze(['yellow']), // Source control graph foreground color (4).
  'scmGraph.foreground5': Object.freeze(['cyan']), // Source control graph foreground color (5).
  'scmGraph.historyItemHoverAdditionsForeground': Object.freeze(['green']), // History item hover additions foreground color.
  'scmGraph.historyItemHoverDeletionsForeground': Object.freeze(['red']), // History item hover deletions foreground color.
  'scmGraph.historyItemRefColor': Object.freeze(['blue']), // History item reference color.
  'scmGraph.historyItemRemoteRefColor': Object.freeze(['green']), // History item remote reference color.
  'scmGraph.historyItemBaseRefColor': Object.freeze(['magenta']), // History item base reference color.
  'scmGraph.historyItemHoverDefaultLabelForeground': Object.freeze(['fg-main']), // History item hover default label foreground color.
  'scmGraph.historyItemHoverDefaultLabelBackground': Object.freeze(['bg-dim']), // History item hover default label background color.

  // Settings Editor colors:
  //
  'settings.headerForeground': Object.freeze(['fg-main']), // The foreground color for a section header or active title.
  'settings.modifiedItemIndicator': Object.freeze(['blue']), // The line that indicates a modified setting.
  'settings.dropdownBackground': Object.freeze(['bg-dim']), // Dropdown background.
  'settings.dropdownForeground': Object.freeze(['fg-main']), // Dropdown foreground.
  'settings.dropdownBorder': Object.freeze(['border']), // Dropdown border.
  'settings.dropdownListBorder': Object.freeze(['border']), // Dropdown list border.
  'settings.checkboxBackground': Object.freeze(['bg-dim']), // Checkbox background.
  'settings.checkboxForeground': Object.freeze(['fg-main']), // Checkbox foreground.
  'settings.checkboxBorder': Object.freeze(['border']), // Checkbox border.
  'settings.rowHoverBackground': Object.freeze(['bg-hover']), // The background color of a settings row when hovered.
  'settings.textInputBackground': Object.freeze(['bg-dim']), // Text input box background.
  'settings.textInputForeground': Object.freeze(['fg-main']), // Text input box foreground.
  'settings.textInputBorder': Object.freeze(['border']), // Text input box border.
  'settings.numberInputBackground': Object.freeze(['bg-dim']), // Number input box background.
  'settings.numberInputForeground': Object.freeze(['fg-main']), // Number input box foreground.
  'settings.numberInputBorder': Object.freeze(['border']), // Number input box border.
  'settings.focusedRowBackground': Object.freeze(['bg-active']), // Background color of a focused setting row.
  'settings.focusedRowBorder': Object.freeze(['border']), // The color of the row's top and bottom border when the row is focused.
  'settings.headerBorder': Object.freeze(['border']), // The color of the header container border.
  'settings.sashBorder': Object.freeze(['border']), // The color of the Settings editor splitview sash border.
  'settings.settingsHeaderHoverForeground': Object.freeze(['fg-main']), // The foreground color for a section header or hovered title.

  // Breadcrumbs colors:
  //
  'breadcrumb.foreground': Object.freeze(['fg-dim']), // Color of breadcrumb items.
  'breadcrumb.background': Object.freeze(['bg-dim']), // Background color of breadcrumb items.
  'breadcrumb.focusForeground': Object.freeze(['fg-main']), // Color of focused breadcrumb items.
  'breadcrumb.activeSelectionForeground': Object.freeze(['fg-main']), // Color of selected breadcrumb items.
  'breadcrumbPicker.background': Object.freeze(['bg-dim']), // Background color of breadcrumb item picker.

  // Snippets colors:
  //
  'editor.snippetTabstopHighlightBackground': Object.freeze(['bg-blue-nuanced']), // Highlight background color of a snippet tabstop.
  'editor.snippetTabstopHighlightBorder': Object.freeze(['blue']), // Highlight border color of a snippet tabstop.
  'editor.snippetFinalTabstopHighlightBackground': Object.freeze(['bg-green-nuanced']), // Highlight background color of the final tabstop of a snippet.
  'editor.snippetFinalTabstopHighlightBorder': Object.freeze(['green']), // Highlight border color of the final tabstop of a snippet.

  // Symbol Icons colors:
  //
  'symbolIcon.arrayForeground': Object.freeze(['magenta']), // The foreground color for array symbols.
  'symbolIcon.booleanForeground': Object.freeze(['blue']), // The foreground color for boolean symbols.
  'symbolIcon.classForeground': Object.freeze(['yellow']), // The foreground color for class symbols.
  'symbolIcon.colorForeground': Object.freeze(['cyan']), // The foreground color for color symbols.
  'symbolIcon.constantForeground': Object.freeze(['cyan']), // The foreground color for constant symbols.
  'symbolIcon.constructorForeground': Object.freeze(['magenta']), // The foreground color for constructor symbols.
  'symbolIcon.enumeratorForeground': Object.freeze(['yellow']), // The foreground color for enumerator symbols.
  'symbolIcon.enumeratorMemberForeground': Object.freeze(['cyan']), // The foreground color for enumerator member symbols.
  'symbolIcon.eventForeground': Object.freeze(['magenta']), // The foreground color for event symbols.
  'symbolIcon.fieldForeground': Object.freeze(['blue']), // The foreground color for field symbols.
  'symbolIcon.fileForeground': Object.freeze(['fg-alt']), // The foreground color for file symbols.
  'symbolIcon.folderForeground': Object.freeze(['fg-alt']), // The foreground color for folder symbols.
  'symbolIcon.functionForeground': Object.freeze(['green']), // The foreground color for function symbols.
  'symbolIcon.interfaceForeground': Object.freeze(['cyan']), // The foreground color for interface symbols.
  'symbolIcon.keyForeground': Object.freeze(['blue']), // The foreground color for key symbols.
  'symbolIcon.keywordForeground': Object.freeze(['magenta']), // The foreground color for keyword symbols.
  'symbolIcon.methodForeground': Object.freeze(['green']), // The foreground color for method symbols.
  'symbolIcon.moduleForeground': Object.freeze(['yellow']), // The foreground color for module symbols.
  'symbolIcon.namespaceForeground': Object.freeze(['yellow']), // The foreground color for namespace symbols.
  'symbolIcon.nullForeground': Object.freeze(['blue']), // The foreground color for null symbols.
  'symbolIcon.numberForeground': Object.freeze(['magenta']), // The foreground color for number symbols.
  'symbolIcon.objectForeground': Object.freeze(['yellow']), // The foreground color for object symbols.
  'symbolIcon.operatorForeground': Object.freeze(['fg-alt']), // The foreground color for operator symbols.
  'symbolIcon.packageForeground': Object.freeze(['yellow']), // The foreground color for package symbols.
  'symbolIcon.propertyForeground': Object.freeze(['blue']), // The foreground color for property symbols.
  'symbolIcon.referenceForeground': Object.freeze(['cyan']), // The foreground color for reference symbols.
  'symbolIcon.snippetForeground': Object.freeze(['green']), // The foreground color for snippet symbols.
  'symbolIcon.stringForeground': Object.freeze(['green']), // The foreground color for string symbols.
  'symbolIcon.structForeground': Object.freeze(['yellow']), // The foreground color for struct symbols.
  'symbolIcon.textForeground': Object.freeze(['green']), // The foreground color for text symbols.
  'symbolIcon.typeParameterForeground': Object.freeze(['cyan']), // The foreground color for type parameter symbols.
  'symbolIcon.unitForeground': Object.freeze(['magenta']), // The foreground color for unit symbols.
  'symbolIcon.variableForeground': Object.freeze(['blue']), // The foreground color for variable symbols.

  // Debug Icons colors:
  //
  'debugIcon.breakpointForeground': Object.freeze(['red']), // Icon color for breakpoints.
  'debugIcon.breakpointDisabledForeground': Object.freeze(['red-faint']), // Icon color for disabled breakpoints.
  'debugIcon.breakpointUnverifiedForeground': Object.freeze(['yellow']), // Icon color for unverified breakpoints.
  'debugIcon.breakpointCurrentStackframeForeground': Object.freeze(['yellow-intense']), // Icon color for the current breakpoint stack frame.
  'debugIcon.breakpointStackframeForeground': Object.freeze(['yellow']), // Icon color for all breakpoint stack frames.
  'debugIcon.startForeground': Object.freeze(['green']), // Debug toolbar icon for start debugging.
  'debugIcon.pauseForeground': Object.freeze(['blue']), // Debug toolbar icon for pause.
  'debugIcon.stopForeground': Object.freeze(['red']), // Debug toolbar icon for stop.
  'debugIcon.disconnectForeground': Object.freeze(['yellow']), // Debug toolbar icon for disconnect.
  'debugIcon.restartForeground': Object.freeze(['green']), // Debug toolbar icon for restart.
  'debugIcon.stepOverForeground': Object.freeze(['blue']), // Debug toolbar icon for step over.
  'debugIcon.stepIntoForeground': Object.freeze(['blue']), // Debug toolbar icon for step into.
  'debugIcon.stepOutForeground': Object.freeze(['blue']), // Debug toolbar icon for step out.
  'debugIcon.continueForeground': Object.freeze(['green']), // Debug toolbar icon for continue.
  'debugIcon.stepBackForeground': Object.freeze(['blue']), // Debug toolbar icon for step back.
  'debugConsole.infoForeground': Object.freeze(['blue']), // Foreground color for info messages in debug REPL console.
  'debugConsole.warningForeground': Object.freeze(['yellow']), // Foreground color for warning messages in debug REPL console.
  'debugConsole.errorForeground': Object.freeze(['red']), // Foreground color for error messages in debug REPL console.
  'debugConsole.sourceForeground': Object.freeze(['cyan']), // Foreground color for source filenames in debug REPL console.
  'debugConsoleInputIcon.foreground': Object.freeze(['fg-alt']), // Foreground color for debug console input marker icon.

  // Notebook colors:
  //
  'notebook.editorBackground': Object.freeze(['bg-main']), // Notebook background color.
  'notebook.cellBorderColor': Object.freeze(['border']), // The border color for notebook cells.
  'notebook.cellHoverBackground': Object.freeze(['bg-hover']), // The background color of a cell when the cell is hovered.
  'notebook.cellInsertionIndicator': Object.freeze(['blue']), // The color of the notebook cell insertion indicator.
  'notebook.cellStatusBarItemHoverBackground': Object.freeze(['bg-hover']), // The background color of notebook cell status bar items.
  'notebook.cellToolbarSeparator': Object.freeze(['border']), // The color of the separator in the cell bottom toolbar
  'notebook.cellEditorBackground': Object.freeze(['bg-dim']), // The color of the notebook cell editor background
  'notebook.focusedCellBackground': Object.freeze(['bg-active']), // The background color of a cell when the cell is focused.
  'notebook.focusedCellBorder': Object.freeze(['blue']), // The color of the cell's focus indicator borders when the cell is focused.
  'notebook.focusedEditorBorder': Object.freeze(['blue']), // The color of the notebook cell editor border.
  'notebook.inactiveFocusedCellBorder': Object.freeze(['blue-faint']), // The color of the cell's top and bottom border when a cell is focused while the primary focus is outside of the editor.
  'notebook.inactiveSelectedCellBorder': Object.freeze(['border']), // The color of the cell's borders when multiple cells are selected.
  'notebook.outputContainerBackgroundColor': Object.freeze(['bg-active-argument']), // The Color of the notebook output container background.
  'notebook.outputContainerBorderColor': Object.freeze(['border']), // The border color of the notebook output container.
  'notebook.selectedCellBackground': Object.freeze(['bg-active']), // The background color of a cell when the cell is selected.
  'notebook.selectedCellBorder': Object.freeze(['border']), // The color of the cell's top and bottom border when the cell is selected but not focused.
  'notebook.symbolHighlightBackground': Object.freeze(['bg-search-lazy']), // Background color of highlighted cell
  'notebookScrollbarSlider.activeBackground': Object.freeze(['bg-blue-nuanced']), // Notebook scrollbar slider background color when clicked on.
  'notebookScrollbarSlider.background': Object.freeze(['bg-inactive']), // Notebook scrollbar slider background color.
  'notebookScrollbarSlider.hoverBackground': Object.freeze(['bg-hover']), // Notebook scrollbar slider background color when hovering.
  'notebookStatusErrorIcon.foreground': Object.freeze(['red']), // The error icon color of notebook cells in the cell status bar.
  'notebookStatusRunningIcon.foreground': Object.freeze(['blue']), // The running icon color of notebook cells in the cell status bar.
  'notebookStatusSuccessIcon.foreground': Object.freeze(['green']), // The success icon color of notebook cells in the cell status bar.
  'notebookEditorOverviewRuler.runningCellForeground': Object.freeze(['blue']), // The color of the running cell decoration in the notebook editor overview ruler.

  // Chart colors:
  //
  'charts.foreground': Object.freeze(['fg-main']), // Contrast color for text in charts.
  'charts.lines': Object.freeze(['border']), // Color for lines in charts.
  'charts.red': Object.freeze(['red']), // Color for red elements in charts.
  'charts.blue': Object.freeze(['blue']), // Color for blue elements in charts.
  'charts.yellow': Object.freeze(['yellow']), // Color for yellow elements in charts.
  'charts.orange': Object.freeze(['yellow-warmer']), // Color for orange elements in charts.
  'charts.green': Object.freeze(['green']), // Color for green elements in charts.
  'charts.purple': Object.freeze(['magenta']), // Color for purple elements in charts.
  'chart.line': Object.freeze(['border']), // Line color for the chart.
  'chart.axis': Object.freeze(['fg-dim']), // Axis color for the chart.
  'chart.guide': Object.freeze(['border']), // Guide line for the chart.

  // Ports colors:
  //
  'ports.iconRunningProcessForeground': Object.freeze(['blue']), // The color of the icon for a port that has an associated running process.

  // Comments View colors:
  //
  'commentsView.resolvedIcon': Object.freeze(['green']), // Icon color for resolved comments.
  'commentsView.unresolvedIcon': Object.freeze(['yellow']), // Icon color for unresolved comments.

  // Action Bar colors:
  //
  'actionBar.toggledBackground': Object.freeze(['bg-active']), // Background color for toggled action items in action bar.

  // Simple Find Widget colors:
  //
  'simpleFindWidget.sashBorder': Object.freeze(['border']), // Border color of the sash border.

  // Gauge colors:
  //
  'gauge.background': Object.freeze(['bg-dim']), // Gauge background color.
  'gauge.foreground': Object.freeze(['blue']), // Gauge foreground color.
  'gauge.border': Object.freeze(['border']), // Gauge border color.
  'gauge.warningBackground': Object.freeze(['bg-yellow-subtle']), // Gauge warning background color.
  'gauge.warningForeground': Object.freeze(['yellow']), // Gauge warning foreground color.
  'gauge.errorBackground': Object.freeze(['bg-red-subtle']), // Gauge error background color.
  'gauge.errorForeground': Object.freeze(['red']), // Gauge error foreground color.

  // Extension colors:
  //
  'extensionColors': Object.freeze(['fg-dim']), // Color IDs can also be contributed by extensions through the color contribution point. These colors also appear when using code complete in the workbench.colorCustomizations settings and the color theme definition file. Users can see what colors an extension defines in the extension contributions tab.
});

/**
 * Semantic token mappings
 *
 * Tokens auto-generated from https://code.visualstudio.com/api/language-extensions/semantic-highlight-guide#standard-token-types-and-modifiers
 *
 * @const
 * @readonly
 */
const SEMANTIC: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'namespace':      Object.freeze(['']), // For identifiers that declare or reference a namespace, module, or package.
  'class':          Object.freeze(['']), // For identifiers that declare or reference a class type.
  'enum':           Object.freeze(['']), // For identifiers that declare or reference an enumeration type.
  'interface':      Object.freeze(['']), // For identifiers that declare or reference an interface type.
  'struct':         Object.freeze(['']), // For identifiers that declare or reference a struct type.
  'typeParameter':  Object.freeze(['']), // For identifiers that declare or reference a type parameter.
  'type':           Object.freeze(['cyan-cooler']), // For identifiers that declare or reference a type that is not covered above.
  'parameter':      Object.freeze(['']), // For identifiers that declare or reference a function or method parameters.
  'variable':       Object.freeze(['cyan']), // For identifiers that declare or reference a local or global variable.
  'property':       Object.freeze(['']), // For identifiers that declare or reference a member property, member field, or member variable.
  'enumMember':     Object.freeze(['']), // For identifiers that declare or reference an enumeration property, constant, or member.
  'decorator':      Object.freeze(['']), // For identifiers that declare or reference decorators and annotations.
  'event':          Object.freeze(['']), // For identifiers that declare an event property.
  'function':       Object.freeze(['magenta']), // For identifiers that declare a function.

  // @@ Emacs Modus don't have any specific color for method, so we'll use the same color as function.
  //
  'method':         Object.freeze(['magenta']), // For identifiers that declare a member function or method.

  'macro':          Object.freeze(['']), // For identifiers that declare a macro.
  'label':          Object.freeze(['']), // For identifiers that declare a label.
  'comment':        Object.freeze(['fg-dim']), // For tokens that represent a comment.
  'string':         Object.freeze(['blue-warmer']), // For tokens that represent a string literal.
  'keyword':        Object.freeze(['magenta-cooler']), // For tokens that represent a language keyword.
  'number':         Object.freeze(['fg-main']), // For tokens that represent a number literal.
  'regexp':         Object.freeze(['green-cooler']), // For tokens that represent a regular expression literal.
  'operator':       Object.freeze(['fg-main']), // For tokens that represent an operator.
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
  private readonly overrides: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
    // Semantic tokens
    //
    'namespace': Object.freeze({ '': '' }),
    'class': Object.freeze({ '': '' }),
    'enum': Object.freeze({ '': '' }),
    'interface': Object.freeze({ '': '' }),
    'struct': Object.freeze({ '': '' }),
    'typeParameter': Object.freeze({ '': '' }),

    'type': Object.freeze({
      'modus-operandi-tritanopia': 'blue-warmer',
      'modus-vivendi-tritanopia': 'blue-warmer'
    }),

    'parameter': Object.freeze({ '': '' }),

    'variable': Object.freeze({
      'modus-operandi-tritanopia': 'cyan-cooler',
      'modus-vivendi-tritanopia': 'cyan-cooler'
    }),

    'property': Object.freeze({ '': '' }),
    'enumMember': Object.freeze({ '': '' }),
    'decorator': Object.freeze({ '': '' }),
    'event': Object.freeze({ '': '' }),

    'function': Object.freeze({
      'modus-operandi-tritanopia': 'cyan-warmer',
      'modus-vivendi-tritanopia': 'cyan-warmer'
    }),

    'method': Object.freeze({
      'modus-operandi-tritanopia': 'cyan-warmer',
      'modus-vivendi-tritanopia': 'cyan-warmer'
    }),

    'macro': Object.freeze({ '': '' }),
    'label': Object.freeze({ '': '' }),

    'comment': Object.freeze({
      'modus-operandi-tinted': 'red-faint',
      'modus-vivendi-tinted': 'red-faint',
      'modus-operandi-deuteranopia': 'yellow-cooler',
      'modus-vivendi-deuteranopia': 'yellow-cooler',
      'modus-operandi-tritanopia': 'red-faint',
      'modus-vivendi-tritanopia': 'red-faint'
    }),

    'string': Object.freeze({
      'modus-operandi-tritanopia': 'cyan',
      'modus-vivendi-tritanopia': 'cyan'
    }),

    'keyword': Object.freeze({
      'modus-operandi-tritanopia': 'red-cooler',
      'modus-vivendi-tritanopia': 'red-cooler'
    }),

    'number': Object.freeze({ '': '' }),

    'regexp': Object.freeze({
      'modus-operandi-deuteranopia': 'yellow-cooler',
      'modus-vivendi-deuteranopia': 'yellow-cooler',
      'modus-operandi-tritanopia': 'red',
      'modus-vivendi-tritanopia': 'red'
    }),

    'operator': Object.freeze({ '': '' }),
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

      const tokenColors: ITokenStyle[] = [];
      this.processTextMateTokens(tokenColors, palette, id, getColor);
      const semanticTokenColors: Record<string, string | ITokenStyle['settings']> = {};
      this.processSemanticTokens(semanticTokenColors, palette, id, getColor);

      this.logger.info(`Generated theme: ${name}`);

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
