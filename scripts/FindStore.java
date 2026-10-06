// Lists instructions that STORE to a memory operand [reg + DISP] for the given displacements.
// Args: hex displacements; optional lo=0x... hi=0x... address range filter.
// @category RocketLeague
import java.util.*;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.*;
import ghidra.program.model.lang.OperandType;
import ghidra.program.model.listing.*;
import ghidra.program.model.scalar.Scalar;

public class FindStore extends GhidraScript {
	@Override
	protected void run() throws Exception {
		Set<Long> disps = new HashSet<>();
		long lo = 0, hi = Long.MAX_VALUE;
		for (String a : getScriptArgs()) {
			if (a.startsWith("lo=")) {
				lo = Long.decode(a.substring(3));
			}
			else if (a.startsWith("hi=")) {
				hi = Long.decode(a.substring(3));
			}
			else {
				disps.add(Long.decode(a));
			}
		}
		Listing listing = currentProgram.getListing();
		int hits = 0;
		for (Instruction ins : listing.getInstructions(true)) {
			long off = ins.getAddress().getOffset();
			if (off < lo || off >= hi) {
				continue;
			}
			String m = ins.getMnemonicString();
			if (!(m.startsWith("MOV") || m.equals("CVTSI2SS"))) {
				continue;
			}
			if (ins.getNumOperands() < 2 || (ins.getOperandType(0) & OperandType.DYNAMIC) == 0) {
				continue;
			}
			for (Object o : ins.getOpObjects(0)) {
				if (o instanceof Scalar s && disps.contains(s.getValue())) {
					Function f = getFunctionContaining(ins.getAddress());
					println(String.format("STORE %s in %s @ %s : %s", ins.getAddress(),
						f == null ? "?" : f.getName(true), f == null ? "?" : f.getEntryPoint(), ins));
					hits++;
				}
			}
		}
		println("FindStore: " + hits + " stores");
	}
}
