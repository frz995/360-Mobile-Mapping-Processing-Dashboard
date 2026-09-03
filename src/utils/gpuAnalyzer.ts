/**
 * GPU-Accelerated 360° Panorama Quality Assurance Engine
 * Uses WebGL 2.0 / WebGL shaders for high-throughput pixel convolution,
 * 4-sector Laplacian variance, and parallel luminance analysis.
 */

import { quietWarn } from '../lib/quiet';

export interface GpuAnalysisResult {
  isGpuAccelerated: boolean;
  minScore: number;
  meanScore: number;
  worstSector: string;
  sectorScores: { name: string; variance: number; score: number }[];
  avgBrightness: number;
  clippedRatio: number;
  executionMs: number;
  gpuRenderer?: string;
}

class WebGLGpuAnalyzer {
  private gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  private canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private program: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private texCoordBuffer: WebGLBuffer | null = null;
  private isInitialized = false;
  private gpuInfo = 'CPU Fallback';

  constructor() {
    this.initWebGL();
  }

  public getGpuInfo(): string {
    return this.gpuInfo;
  }

  public isAvailable(): boolean {
    return this.isInitialized && this.gl !== null;
  }

  private initWebGL() {
    try {
      if (typeof window === 'undefined') return;

      // Try OffscreenCanvas first for zero UI thread impact, fallback to hidden HTMLCanvasElement
      if (typeof OffscreenCanvas !== 'undefined') {
        this.canvas = new OffscreenCanvas(512, 256);
      } else {
        const c = document.createElement('canvas');
        c.width = 512;
        c.height = 256;
        this.canvas = c;
      }

      const options: WebGLContextAttributes = {
        alpha: false,
        depth: false,
        stencil: false,
        antialias: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance'
      };

      // Try WebGL2 first, fallback to standard WebGL
      this.gl = ((this.canvas as any).getContext('webgl2', options) ||
                 (this.canvas as any).getContext('webgl', options) ||
                 (this.canvas as any).getContext('experimental-webgl', options)) as WebGLRenderingContext | null;

      if (!this.gl) {
        console.info('[GPU Engine] WebGL not supported on this device. Using CPU fallback.');
        return;
      }

      // Query GPU renderer string
      const dbgRenderInfo = this.gl.getExtension('WEBGL_debug_renderer_info');
      if (dbgRenderInfo) {
        this.gpuInfo = this.gl.getParameter(dbgRenderInfo.UNMASKED_RENDERER_WEBGL) || 'WebGL GPU';
      } else {
        this.gpuInfo = this.gl.getParameter(this.gl.RENDERER) || 'WebGL GPU';
      }

      this.initShaders();
      this.initBuffers();
      this.isInitialized = true;
    } catch (err) {
      quietWarn('GPU Engine', 'Initialization notice (using CPU fallback):', err);
      this.gl = null;
      this.isInitialized = false;
    }
  }

  private initShaders() {
    if (!this.gl) return;
    const gl = this.gl;

    const vsSource = `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      varying vec2 v_texCoord;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
      }
    `;

    // 3x3 Discrete Laplacian Fragment Shader with luminance output
    const fsSource = `
      precision mediump float;
      uniform sampler2D u_image;
      uniform vec2 u_textureSize;
      varying vec2 v_texCoord;

      void main() {
        vec2 onePixel = vec2(1.0, 1.0) / u_textureSize;
        
        // Sample center and 4-neighborhood
        vec4 c = texture2D(u_image, v_texCoord);
        vec4 top = texture2D(u_image, v_texCoord + vec2(0.0, -onePixel.y));
        vec4 bottom = texture2D(u_image, v_texCoord + vec2(0.0, onePixel.y));
        vec4 left = texture2D(u_image, v_texCoord + vec2(-onePixel.x, 0.0));
        vec4 right = texture2D(u_image, v_texCoord + vec2(onePixel.x, 0.0));

        // Grayscale conversion: Y = 0.299R + 0.587G + 0.114B
        float lumC = dot(c.rgb, vec3(0.299, 0.587, 0.114));
        float lumT = dot(top.rgb, vec3(0.299, 0.587, 0.114));
        float lumB = dot(bottom.rgb, vec3(0.299, 0.587, 0.114));
        float lumL = dot(left.rgb, vec3(0.299, 0.587, 0.114));
        float lumR = dot(right.rgb, vec3(0.299, 0.587, 0.114));

        // Discrete Laplacian: 4*center - (top + bottom + left + right)
        float laplacian = abs(4.0 * lumC - (lumT + lumB + lumL + lumR));

        // R = normalized laplacian edge energy, G = luminance, B = solar glare indicator (240+), A = 1.0
        float isGlare = (c.r >= 0.941 && c.g >= 0.941 && c.b >= 0.941) ? 1.0 : 0.0;
        gl_FragColor = vec4(laplacian, lumC, isGlare, 1.0);
      }
    `;

    const vs = this.createShader(gl.VERTEX_SHADER, vsSource);
    const fs = this.createShader(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return;

    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      quietWarn('GPU Engine', 'Shader link error:', gl.getProgramInfoLog(prog));
      return;
    }
    this.program = prog;
  }

  private createShader(type: number, source: string): WebGLShader | null {
    if (!this.gl) return null;
    const shader = this.gl.createShader(type);
    if (!shader) return null;
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      quietWarn('GPU Engine', 'Shader compile error:', this.gl.getShaderInfoLog(shader));
      this.gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  private initBuffers() {
    if (!this.gl) return;
    const gl = this.gl;

    // Fullscreen quad [-1, -1] to [1, 1]
    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
        -1,  1,
         1, -1,
         1,  1,
      ]),
      gl.STATIC_DRAW
    );

    // Texture coords (flip Y for WebGL texture orientation)
    this.texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        0.0, 1.0,
        1.0, 1.0,
        0.0, 0.0,
        0.0, 0.0,
        1.0, 1.0,
        1.0, 0.0,
      ]),
      gl.STATIC_DRAW
    );

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  /**
   * Runs GPU-accelerated Laplacian spatial convolution across the equirectangular panorama.
   */
  public analyze(
    imageSource: HTMLImageElement | ImageBitmap | ImageData,
    options?: {
      targetWidth?: number;
      targetHeight?: number;
      roiTopRatio?: number;
      roiBottomRatio?: number;
    }
  ): GpuAnalysisResult | null {
    if (!this.gl || !this.program || !this.texture) return null;
    const t0 = performance.now();
    const gl = this.gl;

    const targetWidth = options?.targetWidth || 512;
    const targetHeight = options?.targetHeight || 256;

    if (this.canvas) {
      if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
        this.canvas.width = targetWidth;
        this.canvas.height = targetHeight;
        gl.viewport(0, 0, targetWidth, targetHeight);
      }
    }

    gl.useProgram(this.program);

    // Bind vertices
    const posLocation = gl.getAttribLocation(this.program, 'a_position');
    gl.enableVertexAttribArray(posLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.vertexAttribPointer(posLocation, 2, gl.FLOAT, false, 0, 0);

    // Bind texcoords
    const texLocation = gl.getAttribLocation(this.program, 'a_texCoord');
    gl.enableVertexAttribArray(texLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.vertexAttribPointer(texLocation, 2, gl.FLOAT, false, 0, 0);

    // Set uniforms
    const uTextureSize = gl.getUniformLocation(this.program, 'u_textureSize');
    gl.uniform2f(uTextureSize, targetWidth, targetHeight);

    // Upload texture to GPU
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if ('data' in imageSource) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, imageSource.width, imageSource.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, imageSource.data);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageSource);
    }

    // Execute GPU shader pass
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Readback processed GPU pixel buffer
    const pixels = new Uint8Array(targetWidth * targetHeight * 4);
    gl.readPixels(0, 0, targetWidth, targetHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    // Compute 4-Sector Variance on the GPU-processed edge response
    const roiTop = options?.roiTopRatio ?? 0.12;
    const roiBottom = options?.roiBottomRatio ?? 0.52;
    const startY = Math.floor(targetHeight * roiTop);
    const endY = Math.floor(targetHeight * roiBottom);

    const sectorWidth = Math.floor(targetWidth / 4);
    const sectorStats = [
      { name: 'Front', sum: 0, sumSq: 0, count: 0 },
      { name: 'Right', sum: 0, sumSq: 0, count: 0 },
      { name: 'Back', sum: 0, sumSq: 0, count: 0 },
      { name: 'Left', sum: 0, sumSq: 0, count: 0 }
    ];

    let totalLuminance = 0;
    let glarePixels = 0;
    let totalSampleCount = 0;

    for (let y = startY; y < endY; y++) {
      for (let x = 0; x < targetWidth; x++) {
        const sectorIdx = Math.min(3, Math.floor(x / sectorWidth));
        const idx = (y * targetWidth + x) * 4;

        const edgeVal = pixels[idx];       // R channel: Laplacian edge magnitude
        const lumVal = pixels[idx + 1];    // G channel: Luminance
        const isGlare = pixels[idx + 2];   // B channel: Glare indicator

        const s = sectorStats[sectorIdx];
        s.sum += edgeVal;
        s.sumSq += edgeVal * edgeVal;
        s.count++;

        totalLuminance += lumVal;
        if (isGlare > 0) glarePixels++;
        totalSampleCount++;
      }
    }

    const sectorScores = sectorStats.map(s => {
      if (s.count === 0) return { name: s.name, variance: 0, score: 0 };
      const mean = s.sum / s.count;
      const variance = (s.sumSq / s.count) - (mean * mean);
      // Calibrated Tenengrad sharpness score conversion
      const score = Math.round(Math.min(100, Math.max(0, Math.sqrt(Math.max(0, variance)) * 4.2)) * 10) / 10;
      return { name: s.name, variance: Math.round(variance * 10) / 10, score };
    });

    const scoresOnly = sectorScores.map(s => s.score);
    const minScore = Math.min(...scoresOnly);
    const meanScore = Math.round((scoresOnly.reduce((a, b) => a + b, 0) / scoresOnly.length) * 10) / 10;
    const worstSectorObj = sectorScores.reduce((worst, cur) => cur.score < worst.score ? cur : worst, sectorScores[0]);

    const avgBrightness = totalSampleCount > 0 ? Math.round((totalLuminance / totalSampleCount) * 10) / 10 : 128.0;
    const clippedRatio = totalSampleCount > 0 ? glarePixels / totalSampleCount : 0;
    const executionMs = Math.round((performance.now() - t0) * 100) / 100;

    return {
      isGpuAccelerated: true,
      minScore,
      meanScore,
      worstSector: worstSectorObj.name,
      sectorScores,
      avgBrightness,
      clippedRatio,
      executionMs,
      gpuRenderer: this.gpuInfo
    };
  }
}

// Global Singleton Instance
export const gpuAnalyzer = new WebGLGpuAnalyzer();

export function isGpuAccelerationSupported(): boolean {
  return gpuAnalyzer.isAvailable();
}

export function getGpuHardwareName(): string {
  return gpuAnalyzer.getGpuInfo();
}
