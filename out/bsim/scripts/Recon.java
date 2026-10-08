// Prints the function count and the functions referencing given data addresses, with their extents.
// @category BSim
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.Reference;

public class Recon extends GhidraScript {
	@Override
	protected void run() throws Exception {
		println("FUNCTIONS " + currentProgram.getFunctionManager().getFunctionCount());
		for (String a : getScriptArgs()) {
			Address t = toAddr(Long.decode(a));
			for (Reference r : getReferencesTo(t)) {
				Function f = getFunctionContaining(r.getFromAddress());
				println(String.format("REF %s <- %s in %s [%s-%s]", t, r.getFromAddress(),
					f == null ? "?" : f.getName(true) + "@" + f.getEntryPoint(),
					f == null ? "" : f.getBody().getMinAddress(), f == null ? "" : f.getBody().getMaxAddress()));
			}
		}
	}
}
