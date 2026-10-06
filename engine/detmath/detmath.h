/* detmath: deterministic float maths functions (musl's implementations, MIT, see COPYRIGHT).
 *
 * The platform's sinf/cosf/... differ between C libraries in the last bit (glibc vs musl vs MSVC),
 * which makes a simulation diverge between platforms. These are compiled from the same source
 * into every build, so the native game server and the WebAssembly clients get identical results.
 * Vendored from musl as bundled with Emscripten 6.0.10, symbols prefixed with det_. */
#ifndef DETMATH_H
#define DETMATH_H

#ifdef __cplusplus
extern "C" {
#endif

float det_sinf(float x);
float det_cosf(float x);
float det_tanf(float x);
float det_asinf(float x);
float det_acosf(float x);
float det_atanf(float x);
float det_atan2f(float y, float x);
float det_expf(float x);
float det_logf(float x);
float det_powf(float x, float y);

#ifdef __cplusplus
}
#endif

#endif
