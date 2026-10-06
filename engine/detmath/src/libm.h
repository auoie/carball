/* Minimal replacement for musl's internal libm.h, for the vendored functions in this directory.
 * Self-contained (no <math.h>), so the same code is compiled natively and for WebAssembly,
 * whatever the platform's own C library is. Only exact operations (sqrt, fabs, floor) are left
 * to the compiler; they are correctly rounded by IEEE 754 on every target. */
#ifndef DETMATH_LIBM_H
#define DETMATH_LIBM_H

#include <stdint.h>
#include <float.h>
#include "../detmath.h"

#if FLT_EVAL_METHOD != 0
#error "detmath requires FLT_EVAL_METHOD == 0 (SSE2 or WebAssembly, no x87)"
#endif

typedef float float_t;
typedef double double_t;

#define hidden __attribute__((__visibility__("hidden")))

#define WANT_ROUNDING 1
#define WANT_SNAN 0
#define issignalingf_inline(x) 0
#define issignaling_inline(x) 0
#define TOINT_INTRINSICS 0

#ifdef __GNUC__
#define predict_true(x) __builtin_expect(!!(x), 1)
#define predict_false(x) __builtin_expect(x, 0)
#else
#define predict_true(x) (x)
#define predict_false(x) (x)
#endif

static inline float eval_as_float(float x) { float y = x; return y; }
static inline double eval_as_double(double x) { double y = x; return y; }

static inline float fp_barrierf(float x) { volatile float y = x; return y; }
static inline double fp_barrier(double x) { volatile double y = x; return y; }
static inline void fp_force_evalf(float x) { volatile float y; y = x; }
static inline void fp_force_eval(double x) { volatile double y; y = x; }

/* Only evaluated for floating-point exception side effects; never changes a result */
#define FORCE_EVAL(x) do {                    \
	if (sizeof(x) == sizeof(float))       \
		fp_force_evalf(x);            \
	else                                  \
		fp_force_eval(x);             \
} while (0)

#define asuint(f) ((union{float _f; uint32_t _i;}){f})._i
#define asfloat(i) ((union{uint32_t _i; float _f;}){i})._f
#define asuint64(f) ((union{double _f; uint64_t _i;}){f})._i
#define asdouble(i) ((union{uint64_t _i; double _f;}){i})._f

#define EXTRACT_WORDS(hi,lo,d) do { uint64_t __u = asuint64(d); (hi) = __u >> 32; (lo) = (uint32_t)__u; } while (0)
#define GET_HIGH_WORD(hi,d) do { (hi) = asuint64(d) >> 32; } while (0)
#define GET_LOW_WORD(lo,d) do { (lo) = (uint32_t)asuint64(d); } while (0)
#define INSERT_WORDS(d,hi,lo) do { (d) = asdouble(((uint64_t)(hi)<<32) | (uint32_t)(lo)); } while (0)
#define SET_HIGH_WORD(d,hi) INSERT_WORDS(d, hi, (uint32_t)asuint64(d))
#define SET_LOW_WORD(d,lo) INSERT_WORDS(d, asuint64(d)>>32, lo)
#define GET_FLOAT_WORD(w,d) do { (w) = asuint(d); } while (0)
#define SET_FLOAT_WORD(d,w) do { (d) = asfloat(w); } while (0)

/* Exact operations (correctly rounded everywhere) */
#define fabsf(x) __builtin_fabsf(x)
#define fabs(x) __builtin_fabs(x)
#define sqrtf(x) __builtin_sqrtf(x)
#define sqrt(x) __builtin_sqrt(x)
#define floor(x) __builtin_floor(x)
#define isnan(x) __builtin_isnan(x)

#define INFINITY __builtin_inff()
#define M_PI_2 1.57079632679489661923

/* Internal functions */
hidden int det__rem_pio2_large(double*, double*, int, int, int);
hidden int det__rem_pio2f(float, double*);
hidden float det__sindf(double);
hidden float det__cosdf(double);
hidden float det__tandf(double, int);
hidden double det_scalbn(double, int);

hidden float det__math_xflowf(uint32_t, float);
hidden float det__math_uflowf(uint32_t);
hidden float det__math_oflowf(uint32_t);
hidden float det__math_divzerof(uint32_t);
hidden float det__math_invalidf(float);

#endif
