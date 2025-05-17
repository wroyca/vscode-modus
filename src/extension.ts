import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { Stats } from 'fs';
import * as path from 'path';
import { Disposable } from 'vscode';

/**
 * Theme type enumeration that categorizes themes by luminance characteristics
 * @readonly
 */
enum ThemeType {
  LIGHT = 'light',
  DARK = 'dark'
}

/**
 * Base theme interface defining core properties that all theme variants must
 * implement
 */
interface ITheme {
  /** Unique identifier for theme differentiation */
  readonly id: string;

  /** Human-readable display name */
  readonly name: string;

  /** Luminance classification */
  readonly type: ThemeType;
}

/**
 * Theme definition that extends the base theme with source metadata
 */
interface IThemeDefinition extends ITheme {
  /** Relative path to the source definition file */
  readonly source: string;

  /** User-facing descriptive text */
  readonly description: string;
}

/**
 * Base color specification interface
 */
interface IColor {
  /** Direct hexadecimal color values */
  readonly hex: Record<string, string>;

  /** Semantic color references that map to direct values */
  readonly semantic: Record<string, string>;
}

/**
 * Color transformation service
 */
interface IColorTransformer {
  /**
   * Apply opacity to a hex color
   *
   * @param hex - Hex color string (with or without # prefix)
   * @param opacity - Opacity value between 0 and 1
   * @returns Hex color with alpha channel (#RRGGBBAA)
   * @throws {ThemeProcessingError} If the hex color format is invalid
   */
  applyOpacity(hex: string, opacity: number): string;
}

/**
 * Extended color palette with theme-specific variant support
 */
interface IColorPalette extends IColor {
  /** Theme-specific color overrides organized by theme identifier */
  readonly variants?: Record<string, Record<string, string>>;
}

/**
 * Token styling specification
 */
interface IToken {
  readonly style: string | {
    readonly foreground?: string;
    readonly fontStyle?: string;
    readonly background?: string;
  };
}

/**
 * TextMate token specification
 */
interface ITextMateToken extends IToken {
  /** TextMate scope selector pattern */
  readonly scope: string | string[];
}

/**
 * Semantic token specification
 */
interface ISemanticToken extends IToken {
  /** Semantic token type identifier */
  readonly type: string;
}

/**
 * VS Code specific theme format
 */
interface IThemeVSC extends ITheme {
  /** Editor color definitions for VS Code components */
  readonly colors: Record<string, string>;

  /** Token styling specifications organized by token system */
  readonly tokens: {
    readonly textMate: ITextMateToken[];
    readonly semantic: ISemanticToken[];
  };
}

/**
 * Editor element to color mapping specification
 */
interface IEditorMapping {
  /** Editor element identifier in the VS Code schema */
  readonly element: string;

  /** Color reference to be resolved against the palette */
  readonly color: string;
}

/**
 * Token to color mapping specification
 */
interface ITokenMapping {
  /** Token identification pattern */
  readonly scopeOrType: string;

  /** Color reference to be resolved against the palette */
  readonly color: string;
}

/**
 * User configuration schema
 */
interface IConfiguration {
  /** User-defined color customizations */
  readonly colorOverrides: Record<string, string>;

  /** Flag for experimental functionality */
  readonly experimental: boolean;
}

/**
 * File system observation service
 */
interface IFileWatcher {
  /**
   * Establish observation of a specific file
   *
   * @param path - Path to the file to observe
   * @param callback - Function to invoke upon detected changes
   * @returns Disposable resource for managing the observation lifecycle
   */
  watchFile(path: string, callback: () => void): Disposable;

  /**
   * Establish observation of a directory and its contents
   *
   * @param path - Path to the directory to observe
   * @param callback - Function to invoke upon detected changes
   * @returns Disposable resource for managing the observation lifecycle
   */
  watchDir(path: string, callback: () => void): Disposable;
}

/**
 * Configuration repository
 */
interface IConfigurationRepository {
  /**
   * Retrieve current configuration state
   *
   * @returns Current configuration values
   */
  retrieveConfiguration(): IConfiguration;

  /**
   * Register for configuration change notifications
   *
   * @param handler - Callback function for configuration changes
   * @returns Disposable resource for managing the subscription lifecycle
   */
  onConfigurationChanged(handler: (config: IConfiguration) => void): Disposable;
}

/**
 * Color resolution service
 */
interface IColorResolver {
  /**
   * Resolve a color reference with opacity notation
   *
   * @param reference - Color reference with opacity (format: "color-name@opacity")
   * @param palette - Color palette to resolve against
   * @returns Resolved hex color with opacity applied
   * @throws {ThemeProcessingError} If the reference is invalid or cannot be resolved
   */
  resolveColorWithOpacity(reference: string, palette: IColorPalette): string;

  /**
   * Parse and validate an opacity value
   *
   * @param opacityStr - String representation of opacity value
   * @param fullReference - Full color reference for error context
   * @returns Validated opacity value between 0 and 1
   * @throws {ThemeProcessingError} If opacity value is invalid
   */
  parseAndValidateOpacity(opacityStr: string, fullReference: string): number;

  /**
   * Resolve a base color name to its hex value
   *
   * @param baseColorName - Base color name (without opacity suffix)
   * @param palette - Color palette to resolve against
   * @returns Resolved hex color
   * @throws {ThemeProcessingError} If base color cannot be resolved
   */
  resolveBaseColor(baseColorName: string, palette: IColorPalette): string;

  /**
   * Find and resolve a color from theme variants
   *
   * @param colorName - Color name to find
   * @param palette - Color palette containing variants
   * @returns Resolved color or undefined if not found
   */
  findAndResolveVariantColor(colorName: string, palette: IColorPalette): string | undefined;
}

/**
 * Theme analysis service
 */
interface IThemeAnalyzer {
  /**
   * Analyze a theme source file and extract color definitions
   *
   * @param path - Path to the theme source file
   * @returns Promise resolving to the extracted color definitions
   */
  analyzeSource(path: string): Promise<IColor>;

  /**
   * Load extension data for palette customization
   *
   * @param path - Path to the extensions file
   * @returns Promise resolving to the palette extensions
   */
  loadExtensions(path: string): Promise<IColorPalette>;

  /**
   * Merge multiple color sources into a unified palette
   *
   * @param base - Base color definitions
   * @param extensions - Extension color definitions
   * @param overrides - User override color definitions
   * @param themeId - Target theme identifier
   * @returns Unified color palette
   */
  mergeColorSources(base: IColor, extensions: IColorPalette, overrides: Record<string, string>, themeId: string): IColorPalette;

  /**
   * Resolve a symbolic color name to its concrete hex value
   *
   * @param name - Color name or reference
   * @param palette - Color palette to resolve against
   * @returns Resolved hex color value or undefined if not resolvable
   */
  resolveColorReference(name: string, palette: IColorPalette): string | undefined;
}

/**
 * Theme generation service
 */
interface IThemeFactory {
  /**
   * Synthesize VS Code theme from components
   *
   * @param theme - Theme definition metadata
   * @param palette - Color palette for token and editor coloring
   * @param editorMappings - Editor element color assignments
   * @param tokenMappings - Token color assignments
   * @returns Constructed VS Code theme
   */
  synthesizeTheme(
    theme: IThemeDefinition,
    palette: IColorPalette,
    editorMappings: IEditorMapping[],
    tokenMappings: ITokenMapping[]
  ): IThemeVSC;
}

/**
 * Theme serialization service
 */
interface IThemeSerializer {
  /**
   * Serialize theme to VS Code's format specification
   *
   * @param theme - Internal theme representation
   * @returns VS Code compatible theme object
   */
  serialize(theme: IThemeVSC): any;
}

/**
 * Theme orchestration service
 */
interface IThemeOrchestrator {
  /**
   * Generate all themes from source definitions
   *
   * @param extensionPath - Path to the extension root
   * @param config - User configuration
   * @returns Promise that resolves when generation completes
   */
  generateAllThemes(extensionPath: string, config: IConfiguration): Promise<void>;

  /**
   * Detect modifications to source files
   *
   * @param extensionPath - Path to the extension root
   * @returns Promise resolving to true if changes detected
   */
  detectSourceModifications(extensionPath: string): Promise<boolean>;
}

/**
 * Domain-specific error for theme processing
 */
class ThemeProcessingError extends Error {
  /** Error classification code */
  public readonly code: string;

  /** Original error that triggered this error */
  public readonly cause?: Error;

  /**
   * Construct a new theme processing error
   *
   * @param message - Descriptive error message
   * @param code - Error classification code
   * @param cause - Original triggering error if applicable
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
 * Standard implementation of color transformation service
 */
class StandardColorTransformer implements IColorTransformer {
  /**
   * Apply opacity to a hex color
   *
   * @param hex - Hex color string (with or without # prefix)
   * @param opacity - Opacity value between 0 and 1
   * @returns Hex color with alpha channel (#RRGGBBAA)
   * @throws {ThemeProcessingError} If the hex color format is invalid
   */
  public applyOpacity(hex: string, opacity: number): string {
    //
    if (!hex) {
      throw new ThemeProcessingError(
        'Invalid hex color: empty or undefined',
        'COLOR_FORMAT_ERROR'
      );
    }

    if (!hex.startsWith('#')) {
      hex = `#${hex}`;
    }

    const hexWithoutPrefix = hex.replace('#', '');

    // 8-digit RGBA formats (with alpha channel) are intentionally rejected to
    // prevent ambiguity when appending our calculated alpha value.
    //
    if (!/^[0-9A-Fa-f]{6}$/.test(hexWithoutPrefix)) {
      throw new ThemeProcessingError(
        `Invalid hex color format: ${hex}`,
        'COLOR_FORMAT_ERROR'
      );
    }

    const alpha = Math.round(opacity * 255)
      .toString(16)
      .padStart(2, '0');

    return `#${hexWithoutPrefix}${alpha}`;
  }
}

/**
 * File system observer implementation
 */
class FileSystemWatcher implements IFileWatcher {
  /**
   * Establish file observation
   *
   * @param filePath - Path to the file to observe
   * @param callback - Function to invoke on file changes
   * @returns Disposable for observation lifecycle management
   */
  public watchFile(filePath: string, callback: () => void): Disposable {
    const watcher = fsSync.watch(filePath, () => {
      callback();
    });

    return new Disposable(() => {
      watcher.close();
    });
  }

  /**
   * Establish directory observation
   *
   * @param dirPath - Path to the directory to observe
   * @param callback - Function to invoke on directory changes
   * @returns Disposable for observation lifecycle management
   */
  public watchDir(dirPath: string, callback: () => void): Disposable {
    const watcher = fsSync.watch(dirPath, { recursive: true }, () => {
      callback();
    });

    return new Disposable(() => {
      watcher.close();
    });
  }
}

/**
 * Configuration repository implementation
 */
class ConfigurationRepository implements IConfigurationRepository {
  /**
   * Retrieve current configuration values
   *
   * @returns Current configuration state
   */
  public retrieveConfiguration(): IConfiguration {
    try {
      const config = vscode.workspace.getConfiguration('modus');

      return {
        colorOverrides: config.get<Record<string, string>>('colorOverrides', {}),
        experimental: config.get<boolean>('experimental', false)
      };
    } catch (error) {
      return {
        colorOverrides: {},
        experimental: false
      };
    }
  }

  /**
   * Register for configuration change events
   *
   * @param handler - Callback for configuration changes
   * @returns Disposable for subscription lifecycle management
   */
  public onConfigurationChanged(handler: (config: IConfiguration) => void): Disposable {
    return vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('modus')) {
        try {
          const newConfig = this.retrieveConfiguration();
          handler(newConfig);
        } catch (error) {
          console.error('Error processing configuration changes', error);
        }
      }
    });
  }
}

/**
 * Standard implementation of color resolution service
 */
class StandardColorResolver implements IColorResolver {
  private readonly transformer: IColorTransformer;
  private readonly colorReferenceResolver: (name: string, palette: IColorPalette) => string | undefined;

  /**
   * Construct a new color resolver
   *
   * @param transformer - Color transformation service
   * @param colorReferenceResolver - Function to resolve color references
   */
  constructor(
    transformer: IColorTransformer,
    colorReferenceResolver: (name: string, palette: IColorPalette) => string | undefined
  ) {
    this.transformer = transformer;
    this.colorReferenceResolver = colorReferenceResolver;
  }

  /**
   * Resolve a color reference with opacity notation
   *
   * @param reference - Color reference with opacity (format: "color-name@opacity")
   * @param palette - Color palette to resolve against
   * @returns Resolved hex color with opacity applied
   * @throws {ThemeProcessingError} If the reference is invalid or cannot be resolved
   */
  public resolveColorWithOpacity(reference: string, palette: IColorPalette): string {
    const [baseColorName, opacityStr] = reference.split('@');
    const opacity = this.parseAndValidateOpacity(opacityStr, reference);
    const baseColor = this.resolveBaseColor(baseColorName, palette);

    return this.transformer.applyOpacity(baseColor, opacity);
  }

  /**
   * Parse and validate an opacity value
   *
   * @param opacityStr - String representation of opacity value
   * @param fullReference - Full color reference for error context
   * @returns Validated opacity value between 0 and 1
   * @throws {ThemeProcessingError} If opacity value is invalid
   */
  public parseAndValidateOpacity(opacityStr: string, fullReference: string): number {
    const opacity = parseFloat(opacityStr);

    if (isNaN(opacity) || opacity < 0 || opacity > 1) {
      throw new ThemeProcessingError(
        `Invalid opacity value: "${opacityStr}" in "${fullReference}"`,
        'COLOR_OPACITY_ERROR'
      );
    }

    return opacity;
  }

  /**
   * Resolve a base color name to its hex value
   *
   * @param baseColorName - Base color name (without opacity suffix)
   * @param palette - Color palette to resolve against
   * @returns Resolved hex color
   * @throws {ThemeProcessingError} If base color cannot be resolved
   */
  public resolveBaseColor(baseColorName: string, palette: IColorPalette): string {
    let baseColorHex: string | undefined;

    if (baseColorName.startsWith('#')) {
      baseColorHex = baseColorName;
    }
    else if (palette.hex[baseColorName]) {
      baseColorHex = palette.hex[baseColorName];
    }
    else if (palette.semantic[baseColorName]) {
      try {
        baseColorHex = this.colorReferenceResolver(baseColorName, palette);
      } catch (error) {
        throw new ThemeProcessingError(
          `Cannot apply opacity to "${baseColorName}": color not found in palette`,
          'COLOR_REFERENCE_ERROR'
        );
      }
    }
    else if (palette.variants) {
      baseColorHex = this.findAndResolveVariantColor(baseColorName, palette);
    }

    if (!baseColorHex) {
      throw new ThemeProcessingError(
        `Cannot apply opacity to "${baseColorName}": color not found in palette`,
        'COLOR_REFERENCE_ERROR'
      );
    }

    return baseColorHex;
  }

  /**
   * Find and resolve a color from theme variants
   *
   * @param colorName - Color name to find
   * @param palette - Color palette containing variants
   * @returns Resolved color or undefined if not found
   */
  public findAndResolveVariantColor(colorName: string, palette: IColorPalette): string | undefined {
    if (!palette.variants) {
      return undefined;
    }

    for (const [themeId, overrides] of Object.entries(palette.variants)) {
      if (overrides[colorName]) {
        try {
          return this.colorReferenceResolver(overrides[colorName], palette);
        } catch (error) {
          continue;
        }
      }
    }

    for (const [themeId, overrides] of Object.entries(palette.variants)) {
      if (overrides[colorName]) {
        return overrides[colorName];
      }
    }

    return undefined;
  }
}

/**
 * Modus theme source analyzer implementation
 */
class ModusThemeAnalyzer implements IThemeAnalyzer {
  private readonly colorTransformer: IColorTransformer;
  private readonly colorResolver: IColorResolver;

  /**
   * Construct a new Modus theme analyzer
   */
  constructor() {
    this.colorTransformer = new StandardColorTransformer();
    this.colorResolver = new StandardColorResolver(
      this.colorTransformer,
      this.resolveColorReference.bind(this)
    );
  }

  /**
   * Analyze a Modus theme source file
   *
   * @param filePath - Path to the Modus theme file
   * @returns Promise resolving to extracted color definitions
   */
  public async analyzeSource(filePath: string): Promise<IColor> {
    if (!filePath) {
      throw new ThemeProcessingError('File path is required', 'INVALID_PATH');
    }

    try {
      const content = await fs.readFile(filePath, 'utf8');
      const hex: Record<string, string> = {};
      const semantic: Record<string, string> = {};

      // (color-name "#RRGGBB")
      //
      const colorRegex = /\(([a-zA-Z0-9-]+)\s+"(#[0-9a-fA-F]{6})"\)/g;
      let match;
      while ((match = colorRegex.exec(content)) !== null) {
        hex[match[1]] = match[2];
      }

      // (semantic-name color-name)
      //
      const semanticRegex = /\(([a-zA-Z0-9-]+)\s+(?!#)([a-zA-Z0-9-]+)\)/g;
      while ((match = semanticRegex.exec(content)) !== null) {
        semantic[match[1]] = match[2];
      }

      if (Object.keys(hex).length === 0) {
        throw new ThemeProcessingError(`No color definitions found in ${filePath}`, 'PARSE_ERROR');
      }

      return { hex, semantic };
    } catch (error) {
      if (error instanceof ThemeProcessingError) {
        throw error;
      }
      throw new ThemeProcessingError(
        `Failed to analyze theme source: ${error instanceof Error ? error.message : String(error)}`,
        'PARSE_ERROR',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Load palette extensions from JSON file
   *
   * @param filePath - Path to extensions JSON file
   * @returns Promise resolving to the palette extensions
   */
  public async loadExtensions(filePath: string): Promise<IColorPalette> {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const extensions = JSON.parse(content) as IColorPalette;
      return extensions;
    } catch (error) {
      return { hex: {}, semantic: {} };
    }
  }

  /**
   * Merge multiple color sources into unified palette
   *
   * @param base - Base color definitions
   * @param extensions - Extension color definitions
   * @param overrides - User override color definitions
   * @param themeId - Target theme identifier
   * @returns Unified color palette
   */
  public mergeColorSources(
    base: IColor,
    extensions: IColorPalette,
    overrides: Record<string, string>,
    themeId: string
  ): IColorPalette {
    const result: IColorPalette = {
      hex: { ...base.hex },
      semantic: { ...base.semantic }
    };

    Object.assign(result.hex, extensions.hex || {});
    Object.assign(result.semantic, extensions.semantic || {});

    if (extensions.variants && extensions.variants[themeId]) {
      Object.entries(extensions.variants[themeId]).forEach(([key, value]) => {
        if (value.startsWith('#')) {
          result.hex[key] = value;
        } else {
          result.semantic[key] = value;
        }
      });
    }

    Object.entries(overrides).forEach(([key, value]) => {
      if (value.startsWith('#')) {
        result.hex[key] = value;
      } else {
        result.semantic[key] = value;
      }
    });

    return result;
  }

  /**
   * Resolve a symbolic color reference to its hex value
   *
   * @param name - Color name or reference
   * @param palette - Color palette to resolve against
   * @returns Resolved hex color value or undefined if not resolvable
   */
  public resolveColorReference(name: string, palette: IColorPalette): string | undefined {
    if (!name || name.trim() === '') {
      return undefined;
    }

    // Supports opacity syntax: "color-name@opacity" where opacity is a value
    // between 0 and 1 Example: "bg-dim@0.5" applies 50% opacity to the bg-dim
    // color
    //
    if (name.includes('@')) {
      return this.colorResolver.resolveColorWithOpacity(name, palette);
    }

    if (name.startsWith('#')) {
      return name;
    }

    if (palette.hex[name]) {
      return palette.hex[name];
    }

    if (palette.semantic[name]) {
      return this.resolveColorReference(palette.semantic[name], palette);
    }

    if (palette.variants) {
      const variantColor = this.colorResolver.findAndResolveVariantColor(name, palette);
      if (variantColor) {
        return this.resolveColorReference(variantColor, palette);
      }
    }

    throw new ThemeProcessingError(
      `Invalid color reference: "${name}" not found in palette`,
      'COLOR_REFERENCE_ERROR'
    );
  }
}

/**
 * Theme factory implementation
 */
class VSCodeThemeFactory implements IThemeFactory {
  private readonly analyzer: IThemeAnalyzer;

  /**
   * Construct new theme factory
   *
   * @param analyzer - Theme analyzer for color resolution
   */
  constructor(analyzer: IThemeAnalyzer) {
    this.analyzer = analyzer;
  }

  /**
   * Synthesize theme from components
   *
   * @param theme - Theme definition metadata
   * @param palette - Color palette for token and editor coloring
   * @param editorMappings - Editor element color assignments
   * @param tokenMappings - Token color assignments
   * @returns Constructed theme
   */
  public synthesizeTheme(
    theme: IThemeDefinition,
    palette: IColorPalette,
    editorMappings: IEditorMapping[],
    tokenMappings: ITokenMapping[]
  ): IThemeVSC {
    const { id, name, type } = theme;

    const colors = this.createEditorColorMap(editorMappings, palette);
    const { textMateTokens, semanticTokens } = this.createTokenMappings(tokenMappings, palette);

    return {
      id,
      name,
      type,
      colors,
      tokens: {
        textMate: textMateTokens,
        semantic: semanticTokens
      }
    };
  }

  /**
   * Create editor color mapping from element definitions
   *
   * @param editorMappings - Editor element mappings
   * @param palette - Color palette
   * @returns Record of editor element IDs to resolved colors
   */
  private createEditorColorMap(
    editorMappings: IEditorMapping[],
    palette: IColorPalette
  ): Record<string, string> {
    const colorMap: Record<string, string> = {};

    for (const mapping of editorMappings) {
      try {
        if (!mapping.color || mapping.color.trim() === '') {
          continue;
        }

        const resolvedColor = this.analyzer.resolveColorReference(mapping.color, palette);
        if (resolvedColor) {
          colorMap[mapping.element] = resolvedColor;
        }
      } catch (error) {
        console.error(`Error resolving color for editor element "${mapping.element}":`, error);
      }
    }

    return colorMap;
  }

  /**
   * Create token mappings organized by token system
   *
   * @param tokenMappings - Token mappings
   * @param palette - Color palette
   * @returns Object containing TextMate and semantic tokens
   */
  private createTokenMappings(
    tokenMappings: ITokenMapping[],
    palette: IColorPalette
  ): { textMateTokens: ITextMateToken[], semanticTokens: ISemanticToken[] } {
    const textMateTokens: ITextMateToken[] = [];
    const semanticTokens: ISemanticToken[] = [];

    for (const mapping of tokenMappings) {
      try {
        if (!mapping.color || mapping.color.trim() === '') {
          continue;
        }

        const resolvedColor = this.analyzer.resolveColorReference(mapping.color, palette);
        if (resolvedColor) {
          // NOTE: Previously, we used the isSemantic property to determine
          // whether a token should be applied to semanticTokenColors. This
          // proved unreliable—VS Code's behavior is inconsistent across
          // languages. Some languages use only TextMate tokens, others use
          // semantic tokens, and many use a combination that can vary by
          // context.
          //
          semanticTokens.push(this.createSemanticToken(mapping.scopeOrType, resolvedColor));
          textMateTokens.push(this.createTextMateToken(mapping.scopeOrType, resolvedColor));
        }
      } catch (error) {
        console.error(`Error resolving color for token "${mapping.scopeOrType}":`, error);
      }
    }

    return { textMateTokens, semanticTokens };
  }

  /**
   * Create semantic token from scope and color
   *
   * @param scope - Semantic token scope
   * @param color - Resolved color value
   * @returns Semantic token object
   */
  private createSemanticToken(scope: string, color: string): ISemanticToken {
    return {
      type: scope,
      style: color
    };
  }

  /**
   * Create TextMate token from scope and color
   *
   * @param scope - TextMate token scope
   * @param color - Resolved color value
   * @returns TextMate token object
   */
  private createTextMateToken(scope: string, color: string): ITextMateToken {
    return {
      scope: [scope],
      style: {
        foreground: color
      }
    };
  }
}

/**
 * Theme serialization implementation
 */
class VSCodeThemeSerializer implements IThemeSerializer {
  /**
   * Serialize a theme to VS Code's format specification
   *
   * @param theme - Internal theme representation
   * @returns VS Code compatible theme object
   */
  public serialize(theme: IThemeVSC): any {
    return {
      "$schema": "vscode://schemas/color-theme",

      name: theme.name,
      type: theme.type,
      colors: theme.colors,

      tokenColors: theme.tokens.textMate.map(token => ({
        scope: token.scope,
        settings: typeof token.style === 'string'
          ? { foreground: token.style }
          : token.style
      })),

      semanticTokenColors: Object.fromEntries(
        theme.tokens.semantic.map(token => [
          token.type,
          token.style
        ])
      )
    };
  }
}

/**
 * Hierarchical configuration processing
 */
abstract class HierarchicalConfigurationProcessor<T> {
  /**
   * Process a hierarchical configuration object recursively
   *
   * @param path - Current path in the configuration hierarchy
   * @param node - Current node being processed
   * @returns Array of processed configuration elements
   */
  public processConfiguration(path: string, node: unknown): T[] {
    const elements: T[] = [];
    this.traverseConfigurationNode(path, node, elements);
    return elements;
  }

  /**
   * Traverse node in the configuration hierarchy
   *
   * Recursively processes the configuration tree, creating path-based
   * identifiers for terminal values.
   *
   * @param path - Current path in the configuration hierarchy
   * @param node - Current node being processed
   * @param accumulator - Result collection for processed elements
   */
  protected traverseConfigurationNode(
    path: string,
    node: unknown,
    accumulator: T[]
  ): void {
    if (typeof node === 'string') {
      const element = this.createElementFromLeaf(path, node);
      accumulator.push(element);
    } else if (typeof node === 'object' && node !== null) {
      this.traverseObjectProperties(path, node as Record<string, unknown>, accumulator);
    }
  }

  /**
   * Traverse properties of an object node
   *
   * @param path - Current path in the configuration hierarchy
   * @param obj - Object whose properties should be traversed
   * @param accumulator - Result collection for processed elements
   */
  protected traverseObjectProperties(
    path: string,
    obj: Record<string, unknown>,
    accumulator: T[]
  ): void {
    for (const [key, value] of Object.entries(obj)) {
      const qualifiedPath = this.constructQualifiedPath(path, key);
      this.traverseConfigurationNode(qualifiedPath, value, accumulator);
    }
  }

  /**
   * Construct qualified path by joining path segments
   *
   * @param currentPath - Current path in the hierarchy
   * @param segment - New path segment to append
   * @returns Qualified path with proper delimiter
   */
  protected constructQualifiedPath(currentPath: string, segment: string): string {
    return currentPath ? `${currentPath}.${segment}` : segment;
  }

  /**
   * Create domain element from leaf node value
   *
   * @param path - Path to the leaf node
   * @param value - Value of the leaf node
   * @returns Domain-specific element
   */
  protected abstract createElementFromLeaf(path: string, value: string): T;
}

/**
 * Editor mapping processor implementation
 *
 * Specialized hierarchical processor for editor color mappings.
 */
class EditorMappingProcessor extends HierarchicalConfigurationProcessor<IEditorMapping> {
  /**
   * Create editor mapping from leaf node
   *
   * @param element - Editor element identifier
   * @param color - Color reference value
   * @returns Editor mapping object
   */
  protected createElementFromLeaf(element: string, color: string): IEditorMapping {
    return { element, color };
  }
}

/**
 * Token mapping processor implementation
 *
 * Specialized hierarchical processor for token color mappings.
 */
class TokenMappingProcessor extends HierarchicalConfigurationProcessor<ITokenMapping> {
  /**
   * Create token mapping from leaf node
   *
   * @param scopeOrType - Token scope or type identifier
   * @param color - Color reference value
   * @returns Token mapping object with semantic classification
   */
  protected createElementFromLeaf(scopeOrType: string, color: string): ITokenMapping {
    return {
      scopeOrType,
      color,
    };
  }
}

/**
 * Theme orchestration service implementation
 */
class ThemeOrchestrationService implements IThemeOrchestrator {
  private readonly analyzer: IThemeAnalyzer;
  private readonly factory: IThemeFactory;
  private readonly serializer: IThemeSerializer;
  private readonly configurationFiles: ReadonlyArray<string>;
  private readonly editorProcessor: EditorMappingProcessor;
  private readonly tokenProcessor: TokenMappingProcessor;
  private lastGenerationTimestamp = 0;

  /**
   * Construct a new theme orchestration service
   */
  constructor(
    analyzer: IThemeAnalyzer,
    factory: IThemeFactory,
    serializer: IThemeSerializer
  ) {
    this.analyzer = analyzer;
    this.factory = factory;
    this.serializer = serializer;
    this.configurationFiles = Object.freeze([
      'modus-palette.json',
      'modus-editor.json',
      'modus-editor-experimental.json',
      'modus-tokens.json',
      'modus-themes.json'
    ]);
    this.editorProcessor = new EditorMappingProcessor();
    this.tokenProcessor = new TokenMappingProcessor();
  }

  /**
   * Detect modifications to source files
   *
   * @param extensionPath - Path to the extension root
   * @returns Promise resolving to true if changes detected
   */
  public async detectSourceModifications(extensionPath: string): Promise<boolean> {
    try {
      const configDir = path.join(extensionPath, 'config');
      const filePaths = this.getConfigurationFilePaths(configDir);
      const fileStats = await this.collectFileStatistics(filePaths);
      const latestModification = this.determineLatestModificationTime(fileStats);

      return latestModification > this.lastGenerationTimestamp;
    } catch (error) {
      console.error('Error detecting file modifications:', error);
      return false;
    }
  }

  /**
   * Get paths to all relevant configuration files
   *
   * @param configDir - Configuration directory
   * @returns Array of file paths to monitor
   */
  private getConfigurationFilePaths(configDir: string): string[] {
    if (!configDir) {
      throw new Error('Configuration directory path is undefined');
    }

    return this.configurationFiles.map(filename =>
      path.join(configDir, filename)
    );
  }

  /**
   * Collect file statistics for the specified files
   *
   * @param filePaths - Paths to analyze
   * @returns Array of file statistics objects or null for missing files
   */
  private async collectFileStatistics(filePaths: string[]): Promise<(Stats | null)[]> {
    return Promise.all(
      filePaths.map(filePath =>
        fs.stat(filePath).catch(error => {
          console.warn(`Failed to stat file ${filePath}:`, error);
          return null;
        })
      )
    );
  }

  /**
   * Determine the latest modification time among the specified files
   *
   * @param fileStats - Array of file statistics objects
   * @returns Latest modification time in milliseconds
   */
  private determineLatestModificationTime(fileStats: (Stats | null)[]): number {
    let latestModification = 0;
    for (const stat of fileStats) {
      if (stat && stat.mtime) {
        const modificationTime = stat.mtime.getTime();
        if (modificationTime > latestModification) {
          latestModification = modificationTime;
        }
      }
    }
    return latestModification;
  }

  /**
   * Generate all themes from source definitions
   *
   * @param extensionPath - Path to the extension root
   * @param config - User configuration
   * @returns Promise that resolves when generation completes
   */
  public async generateAllThemes(extensionPath: string, config: IConfiguration): Promise<void> {
    try {
      const themesDir = path.join(extensionPath, 'themes');
      await fs.mkdir(themesDir, { recursive: true });
      const configDir = path.join(extensionPath, 'config');

      const definitionsPath = path.join(configDir, 'modus-themes.json');
      const definitionsContent = await fs.readFile(definitionsPath, 'utf8');
      const themeDefinitions = JSON.parse(definitionsContent) as IThemeDefinition[];

      const editorPath = path.join(configDir, 'modus-editor.json');
      const editorContent = await fs.readFile(editorPath, 'utf8');
      const editorData = JSON.parse(this.stripJsonComments(editorContent));
      const editorMappings = this.editorProcessor.processConfiguration('', editorData);

      let experimentalEditorMappings: IEditorMapping[] = [];
      if (config.experimental) {
        try {
          const experimentalEditorPath = path.join(configDir, 'modus-editor-experimental.json');
          const experimentalContent = await fs.readFile(experimentalEditorPath, 'utf8');
          const experimentalData = JSON.parse(this.stripJsonComments(experimentalContent));
          experimentalEditorMappings = this.editorProcessor.processConfiguration('', experimentalData);
        } catch (error) {
          console.warn('Failed to load experimental editor mappings:', error);
        }
      }

      const combinedEditorMappings = [...editorMappings];
      if (config.experimental && experimentalEditorMappings.length > 0) {
        combinedEditorMappings.push(...experimentalEditorMappings);
      }

      const tokensPath = path.join(configDir, 'modus-tokens.json');
      const tokensContent = await fs.readFile(tokensPath, 'utf8');
      const tokensData = JSON.parse(this.stripJsonComments(tokensContent));
      const tokenMappings = this.tokenProcessor.processConfiguration('', tokensData);

      const extensionsPath = path.join(configDir, 'modus-palette.json');
      const extensions = await this.analyzer.loadExtensions(extensionsPath);

      const results = await Promise.allSettled(
        themeDefinitions.map(async (theme) => {
          try {
            const sourcePath = path.join(extensionPath, theme.source);
            const outputPath = path.join(themesDir, `${theme.id}-color-theme.json`);

            const basePalette = await this.analyzer.analyzeSource(sourcePath);

            const palette = this.analyzer.mergeColorSources(
              basePalette,
              extensions,
              config.colorOverrides,
              theme.id
            );

            const vscodeTheme = this.factory.synthesizeTheme(
              theme,
              palette,
              combinedEditorMappings,
              tokenMappings
            );

            const exportedTheme = this.serializer.serialize(vscodeTheme);

            await fs.writeFile(outputPath, JSON.stringify(exportedTheme, null, 2));

            return theme.id;
          } catch (error) {
            console.error(`Failed to generate theme ${theme.id}`, error);
            throw error;
          }
        })
      );

      this.lastGenerationTimestamp = Date.now();

      const failedCount = results.filter(r => r.status === 'rejected').length;
      if (failedCount > 0) {
        throw new ThemeProcessingError(
          `Failed to generate ${failedCount} theme(s)`,
          'GENERATION_ERROR'
        );
      }
    } catch (error) {
      throw new ThemeProcessingError(
        `Theme generation process failed: ${error instanceof Error ? error.message : String(error)}`,
        'ORCHESTRATION_ERROR',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Strip C-style comments from JSON string
   *
   */
  private stripJsonComments(jsonString: string): string {
    // Remove single line comments (// comment)
    let result = jsonString.replace(/\/\/.*$/gm, '');

    // Remove multi-line comments (/* comment */)
    result = result.replace(/\/\*[\s\S]*?\*\//g, '');

    return result;
  }
}

/**
 * Extension controller
 */
class ModusThemesExtension {
  private readonly context: vscode.ExtensionContext;
  private readonly configRepository: IConfigurationRepository;
  private readonly themeOrchestrator: IThemeOrchestrator;
  private readonly fileWatcher: IFileWatcher;
  private readonly disposables: vscode.Disposable[] = [];

  /**
   * Construct new extension controller
   *
   * @param context - extension context
   */
  constructor(context: vscode.ExtensionContext) {
    this.context = context;

    const analyzer = new ModusThemeAnalyzer();
    this.configRepository = new ConfigurationRepository();
    this.fileWatcher = new FileSystemWatcher();

    const factory = new VSCodeThemeFactory(analyzer);
    const serializer = new VSCodeThemeSerializer();
    this.themeOrchestrator = new ThemeOrchestrationService(analyzer, factory, serializer);
  }

  /**
   * Activate the extension
   *
   * Initializes the extension and sets up event handlers.
   */
  public async activate(): Promise<void> {
    try {
      console.log('Modus Themes extension activating');

      const config = this.configRepository.retrieveConfiguration();
      await this.themeOrchestrator.generateAllThemes(this.context.extensionPath, config);

      this.disposables.push(
        this.configRepository.onConfigurationChanged(async (newConfig) => {
          try {
            await this.themeOrchestrator.generateAllThemes(this.context.extensionPath, newConfig);

            this.promptForReload('Theme files have been updated');
          } catch (error) {
            vscode.window.showErrorMessage(
              'Modus Themes: Failed to update theme files.'
            );
          }
        })
      );

      const configDir = path.join(this.context.extensionPath, 'config');
      this.disposables.push(
        this.fileWatcher.watchDir(configDir, async () => {
          try {
            const hasChanges = await this.themeOrchestrator.detectSourceModifications(this.context.extensionPath);

            if (hasChanges) {
              const config = this.configRepository.retrieveConfiguration();
              await this.themeOrchestrator.generateAllThemes(this.context.extensionPath, config);
              // this.promptForReload('Theme files have been updated due to configuration changes');
            }
          } catch (error) {
            console.error('Failed to update themes after file changes', error);
          }
        })
      );

      this.registerCommands();

      console.log('Modus Themes extension successfully activated');
    } catch (error) {
      vscode.window.showErrorMessage(
        'Failed to activate Modus Themes extension.'
      );
      throw error;
    }
  }

  /**
   * Register extension commands
   */
  private registerCommands(): void {
    this.disposables.push(
      vscode.commands.registerCommand('modus.reloadWindow', () => {
        vscode.commands.executeCommand('workbench.action.reloadWindow');
      })
    );

    this.disposables.push(
      vscode.commands.registerCommand('modus.regenerateThemes', async () => {
        try {
          const config = this.configRepository.retrieveConfiguration();
          await this.themeOrchestrator.generateAllThemes(this.context.extensionPath, config);

          this.promptForReload('Theme files have been regenerated');
        } catch (error) {
          vscode.window.showErrorMessage(
            'Modus Themes: Failed to regenerate theme files.'
          );
        }
      })
    );
  }

  /**
   * Show reload prompt to user
   *
   * @param message - Message to display in the prompt
   */
  private promptForReload(message: string): void {
    vscode.window.showInformationMessage(
      `Modus Themes: ${message}. Reload window to apply changes.`,
      'Reload Window'
    ).then(selection => {
      if (selection === 'Reload Window') {
        vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    });
  }

  /**
   * Deactivate the extension
   *
   * Cleans up resources when the extension is deactivated.
   */
  public deactivate(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}

/**
 * Extension activation function
 *
 * @param context - VS Code extension context
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const extension = new ModusThemesExtension(context);
  await extension.activate();
}

/**
 * Extension deactivation function
 */
export function deactivate(): void {
  // Extension cleanup handled by ModusThemesExtension instance
}
