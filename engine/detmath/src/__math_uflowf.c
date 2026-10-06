#include "libm.h"

float det__math_uflowf(uint32_t sign)
{
	return det__math_xflowf(sign, 0x1p-95f);
}
