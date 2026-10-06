// Prints all references to the given addresses (calls, jumps, data).
// @category RocketLeague
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.Reference;

public class Refs extends GhidraScript {
	@Override
	protected void run() throws Exception {
		for (String a : getScriptArgs()) {
			Address t = toAddr(Long.decode(a));
			for (Reference r : getReferencesTo(t)) {
				Function f = getFunctionContaining(r.getFromAddress());
				println(String.format("REF %s <- %s %s in %s", t, r.getFromAddress(), r.getReferenceType(),
					f == null ? "?" : f.getName(true) + "@" + f.getEntryPoint()));
			}
		}
	}
}
