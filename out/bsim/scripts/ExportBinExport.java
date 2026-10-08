// Headless BinExport (v2) export for BinDiff: ExportBinExport.java OUT.BinExport
// Needs the BinExport extension (built from github.com/google/binexport java/ for this Ghidra) installed in the
// Ghidra settings dir used by the run (out/bsim/ghidra-config via XDG_CONFIG_HOME, so the user's config is untouched).
// Keeps absolute addresses (no image-base subtraction) and prepends namespaces to names.
// @category BSim
import java.io.FileOutputStream;

import com.google.security.binexport.BinExport2Builder;
import com.google.security.zynamics.BinExport.BinExport2;
import ghidra.app.script.GhidraScript;

public class ExportBinExport extends GhidraScript {
	@Override
	protected void run() throws Exception {
		String out = getScriptArgs()[0];
		var builder = new BinExport2Builder(currentProgram, currentProgram.getMemory());
		builder.setPrependNamespace(true);
		BinExport2 proto = builder.build();
		try (var os = new FileOutputStream(out)) {
			proto.writeTo(os);
		}
		println("EXPORTED " + currentProgram.getName() + " -> " + out);
	}
}
