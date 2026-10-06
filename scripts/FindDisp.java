// Lists functions whose instructions use ALL the given memory displacements (e.g. field offsets).
// Args: hex displacements, e.g. 0xc8 0xd0 0xe8. Optional "min=N" to accept functions matching N of them.
// @category RocketLeague
import java.util.*;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.lang.OperandType;
import ghidra.program.model.listing.*;
import ghidra.program.model.scalar.Scalar;

public class FindDisp extends GhidraScript {
	@Override
	protected void run() throws Exception {
		Set<Long> wanted = new LinkedHashSet<>();
		int min = -1;
		for (String a : getScriptArgs()) {
			if (a.startsWith("min=")) {
				min = Integer.parseInt(a.substring(4));
			}
			else {
				wanted.add(Long.decode(a));
			}
		}
		if (min < 0) {
			min = wanted.size();
		}
		Listing listing = currentProgram.getListing();
		int hits = 0;
		for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
			Set<Long> seen = new HashSet<>();
			for (Instruction ins : listing.getInstructions(f.getBody(), true)) {
				for (int i = 0; i < ins.getNumOperands(); i++) {
					int t = ins.getOperandType(i);
					if ((t & OperandType.DYNAMIC) == 0) {
						continue;
					}
					for (Object o : ins.getOpObjects(i)) {
						if (o instanceof Scalar s && wanted.contains(s.getValue())) {
							seen.add(s.getValue());
						}
					}
				}
			}
			if (seen.size() >= min) {
				println(String.format("HIT %s @ %s  (%d/%d) size=%d", f.getName(true), f.getEntryPoint(),
					seen.size(), wanted.size(), f.getBody().getNumAddresses()));
				hits++;
			}
		}
		println("FindDisp: " + hits + " functions");
	}
}
