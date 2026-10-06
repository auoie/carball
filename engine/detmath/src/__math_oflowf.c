#include "libm.h"

float det__math_oflowf(uint32_t sign)
{
	return det__math_xflowf(sign, 0x1p97f);
}
