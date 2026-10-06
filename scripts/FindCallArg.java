// Finds calls to TARGET whose first argument (RCX) is set by "LEA RCX,[reg + DISP]" shortly before the call.
// Args: TARGET_ADDR DISP [DISP...]
// @category RocketLeague
import java.util.*;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import ghidra.program.model.scalar.Scalar;
import ghidra.program.model.symbol.Reference;

public class FindCallArg extends GhidraScript {
	@Override
	protected void run() throws Exception {
		String[] args = getScriptArgs();
		Address target = toAddr(Long.decode(args[0]));
		Set<Long> disps = new HashSet<>();
		for (int i = 1; i < args.length; i++) {
			disps.add(Long.decode(args[i]));
		}
		Listing listing = currentProgram.getListing();
		int hits = 0;
		for (Reference ref : getReferencesTo(target)) {
			if (!ref.getReferenceType().isCall()) {
				continue;
			}
			Instruction call = listing.getInstructionAt(ref.getFromAddress());
			Instruction ins = call;
			for (int k = 0; k < 12 && ins != null; k++) {
				ins = ins.getPrevious();
				if (ins == null) {
					break;
				}
				String m = ins.getMnemonicString();
				if (!m.equals("LEA")) {
					continue;
				}
				if (!ins.getDefaultOperandRepresentation(0).equals("RCX")) {
					continue;
				}
				for (Object o : ins.getOpObjects(1)) {
					if (o instanceof Scalar s && disps.contains(s.getValue())) {
						Function f = getFunctionContaining(call.getAddress());
						println(String.format("HIT call@%s in %s @ %s : %s", call.getAddress(),
							f == null ? "?" : f.getName(true), f == null ? "?" : f.getEntryPoint(), ins));
						hits++;
					}
				}
				break;  // only the nearest LEA RCX counts
			}
		}
		println("FindCallArg: " + hits + " hits");
	}
}
