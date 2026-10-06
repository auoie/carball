#include "libm.h"

float det__math_invalidf(float x)
{
	return (x - x) / (x - x);
}
