// Names UE3 native exec thunks from out/natives.csv (func_va,class,native,table_entry_va).
// Shared thunks (one address used by several classes) get the first class's name plus a
// plate comment listing every class that registers it.
// @category RocketLeague
import java.io.*;
import java.nio.file.*;
import java.util.*;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;

public class ApplyNatives extends GhidraScript {
	@Override
	protected void run() throws Exception {
		String csv = getScriptArgs().length > 0 ? getScriptArgs()[0]
				: Paths.get(getSourceFile().getParentFile().getAbsolutePath()).resolve("../out/natives.csv").normalize()
						.toString();
		Map<String, List<String>> byAddr = new LinkedHashMap<>();
		List<String> lines = Files.readAllLines(Paths.get(csv));
		for (String line : lines.subList(1, lines.size())) {
			String[] f = line.split(",");
			byAddr.computeIfAbsent(f[0], k -> new ArrayList<>()).add(f[1] + "::" + f[2]);
		}

		SymbolTable st = currentProgram.getSymbolTable();
		Listing listing = currentProgram.getListing();
		int named = 0, created = 0;
		for (Map.Entry<String, List<String>> e : byAddr.entrySet()) {
			Address a = toAddr(Long.decode(e.getKey()));
			List<String> names = e.getValue();
			Function fn = getFunctionAt(a);
			if (fn == null) {
				disassemble(a);
				fn = createFunction(a, null);
				if (fn != null) {
					created++;
				}
			}
			String[] parts = names.get(0).split("::");
			Namespace ns = getOrCreateNamespace(st, parts[0]);
			String label = names.size() > 1 ? parts[1] + "_shared" : parts[1];
			if (fn != null) {
				fn.setParentNamespace(ns);
				fn.setName(label, SourceType.USER_DEFINED);
			}
			else {
				st.createLabel(a, label, ns, SourceType.USER_DEFINED);
			}
			if (names.size() > 1) {
				listing.setComment(a, CommentType.PLATE, "Native thunk registered by:\n  " + String.join("\n  ", names));
			}
			named++;
		}
		println("ApplyNatives: named " + named + " addresses (" + created + " functions created)");
	}

	private Namespace getOrCreateNamespace(SymbolTable st, String name) throws Exception {
		Namespace ns = st.getNamespace(name, currentProgram.getGlobalNamespace());
		if (ns == null) {
			ns = st.createClass(currentProgram.getGlobalNamespace(), name, SourceType.USER_DEFINED);
		}
		return ns;
	}
}
